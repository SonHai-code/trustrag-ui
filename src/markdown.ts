// A small, dependency-free Markdown parser for model answers. Pure functions: text in, a tree out (no HTML strings, so
// nothing the model writes can inject markup; Markdown.tsx turns the tree into React elements).
//
// Supported: paragraphs, # headings, **bold**, *italic*, ~~strike~~, `code`, ``` fences, - * + and 1. lists (nested),
// > quotes, --- rules, | tables |, [text](https://link), bare https:// links, and [n] citation markers.
// Built for STREAMING: a half-written construct (an unclosed ** or fence, a table without its separator row yet) never
// throws; it shows as plain text / an open code block until the rest arrives.

export type Inline =
  | { t: "text"; v: string }
  | { t: "br" }
  | { t: "code"; v: string }
  | { t: "bold" | "italic" | "strike"; c: Inline[] }
  | { t: "link"; href: string; c: Inline[] }
  | { t: "cite"; id: number };

export type Align = "left" | "right" | "center" | null;

export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "h"; level: number; c: Inline[] }
  | { t: "list"; ordered: boolean; start: number; items: Block[][] }
  | { t: "quote"; c: Block[] }
  | { t: "code"; lang: string; v: string; open: boolean }
  | { t: "hr" }
  | { t: "table"; head: Inline[][]; align: Align[]; rows: Inline[][][] };

// ---------------------------------------------------------------- inline

const SAFE_URL = /^(https?:\/\/|mailto:)/i;
const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);
const isSpace = (ch: string | undefined) => ch === undefined || /\s/.test(ch);

function pushText(out: Inline[], v: string) {
  if (!v) return;
  const last = out[out.length - 1];
  if (last && last.t === "text") last.v += v;
  else out.push({ t: "text", v });
}

/** Index of the closing `marker` for an opener that ended at `from`, or -1. Skips escaped characters and code spans. */
function findClose(s: string, marker: string, from: number): number {
  for (let i = from; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "`") {
      const end = s.indexOf("`", i + 1);
      if (end === -1) return -1;
      i = end;
      continue;
    }
    if (s.startsWith(marker, i) && i > from) {
      // `*` must not close on `**` (nested bold inside italic): check the character after
      if (marker.length === 1 && s[i + 1] === marker) {
        i++;
        continue;
      }
      return i;
    }
  }
  return -1;
}

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];

    if (ch === "\\" && i + 1 < s.length && /[\\`*_{}\[\]()#+\-.!~|>]/.test(s[i + 1])) {
      pushText(out, s[i + 1]);
      i += 2;
      continue;
    }
    if (ch === "\n") {
      out.push({ t: "br" });
      i++;
      continue;
    }
    if (ch === "`") {
      const ticks = s.startsWith("``", i) ? "``" : "`";
      const end = s.indexOf(ticks, i + ticks.length);
      if (end > i + ticks.length - 1 && end !== -1) {
        out.push({ t: "code", v: s.slice(i + ticks.length, end).trim() });
        i = end + ticks.length;
        continue;
      }
    }
    if ((ch === "*" || ch === "_") && s[i + 1] === ch) {
      // ** or __ : bold
      const close = findClose(s, ch + ch, i + 2);
      const inner = close === -1 ? "" : s.slice(i + 2, close);
      const intraword = ch === "_" && isWordChar(s[i - 1]);
      if (close !== -1 && inner.trim() && !isSpace(s[i + 2]) && !intraword) {
        out.push({ t: "bold", c: parseInline(inner) });
        i = close + 2;
        continue;
      }
    } else if (ch === "*" || ch === "_") {
      const close = findClose(s, ch, i + 1);
      const inner = close === -1 ? "" : s.slice(i + 1, close);
      const intraword = ch === "_" && (isWordChar(s[i - 1]) || isWordChar(s[close + 1]));
      if (close !== -1 && inner.trim() && !isSpace(s[i + 1]) && !isSpace(s[close - 1]) && !intraword) {
        out.push({ t: "italic", c: parseInline(inner) });
        i = close + 1;
        continue;
      }
    }
    if (ch === "~" && s[i + 1] === "~") {
      const close = s.indexOf("~~", i + 2);
      if (close !== -1 && s.slice(i + 2, close).trim()) {
        out.push({ t: "strike", c: parseInline(s.slice(i + 2, close)) });
        i = close + 2;
        continue;
      }
    }
    if (ch === "[") {
      const cite = /^\[(\d{1,3})\](?!\()/.exec(s.slice(i, i + 8));
      if (cite) {
        out.push({ t: "cite", id: Number(cite[1]) });
        i += cite[0].length;
        continue;
      }
      const link = /^\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/.exec(s.slice(i));
      if (link) {
        if (SAFE_URL.test(link[2])) out.push({ t: "link", href: link[2], c: parseInline(link[1]) });
        else pushText(out, link[1]); // javascript: and friends: keep the words, drop the link
        i += link[0].length;
        continue;
      }
    }
    if (ch === "h" && /^https?:\/\//i.test(s.slice(i, i + 8)) && !isWordChar(s[i - 1])) {
      const m = /^https?:\/\/[^\s<>()]+/i.exec(s.slice(i));
      if (m) {
        const url = m[0].replace(/[.,;:!?'"]+$/, "");
        out.push({ t: "link", href: url, c: [{ t: "text", v: url }] });
        i += url.length;
        continue;
      }
    }
    pushText(out, ch);
    i++;
  }
  return out;
}

// ---------------------------------------------------------------- blocks

const FENCE = /^\s{0,3}(```|~~~)\s*([\w+#.-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

const indentOf = (line: string) => line.length - line.trimStart().length;

function splitRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1);
  return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

function startsBlock(line: string, next?: string): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    HR.test(line) ||
    QUOTE.test(line) ||
    LIST_ITEM.test(line) ||
    (line.includes("|") && next !== undefined && TABLE_SEP.test(next) && next.includes("-"))
  );
}

export function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      let closed = false;
      while (i < lines.length) {
        if (lines[i].trim().startsWith(fence[1])) {
          closed = true;
          i++;
          break;
        }
        body.push(lines[i]);
        i++;
      }
      blocks.push({ t: "code", lang: fence[2], v: body.join("\n"), open: !closed });
      continue;
    }

    const h = HEADING.exec(line);
    if (h) {
      blocks.push({ t: "h", level: h[1].length, c: parseInline(h[2]) });
      i++;
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ t: "hr" });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        inner.push(QUOTE.exec(lines[i])![1]);
        i++;
      }
      blocks.push({ t: "quote", c: parseBlocks(inner) });
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const head = splitRow(line);
      const align: Align[] = splitRow(lines[i + 1]).map((c) =>
        c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : null
      );
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
        const cells = splitRow(lines[i]);
        rows.push(head.map((_, k) => parseInline(cells[k] ?? "")));
        i++;
      }
      blocks.push({ t: "table", head: head.map((c) => parseInline(c)), align, rows });
      continue;
    }

    const li = LIST_ITEM.exec(line);
    if (li) {
      const base = li[1].length;
      const ordered = /\d/.test(li[2]);
      const start = ordered ? parseInt(li[2], 10) : 1;
      const items: string[][] = [];
      while (i < lines.length) {
        const cur = lines[i];
        const m = LIST_ITEM.exec(cur);
        if (m && m[1].length <= base) {
          if (m[1].length < base || /\d/.test(m[2]) !== ordered) break; // a different list starts here
          items.push([m[3]]);
          i++;
        } else if (!cur.trim()) {
          // a blank line continues the list only when the next line is an item or an indented continuation
          const nxt = lines[i + 1];
          if (nxt !== undefined && nxt.trim() && (indentOf(nxt) > base || (LIST_ITEM.test(nxt) && indentOf(nxt) === base))) {
            if (indentOf(nxt) > base) items[items.length - 1]?.push("");
            i++;
          } else break;
        } else if (items.length && indentOf(cur) > base) {
          items[items.length - 1].push(cur.slice(Math.min(indentOf(cur), base + 2)));
          i++;
        } else if (items.length && !startsBlock(cur, lines[i + 1])) {
          items[items.length - 1].push(cur.trim()); // lazy continuation of the item's paragraph
          i++;
        } else break;
      }
      blocks.push({ t: "list", ordered, start, items: items.map((it) => parseBlocks(it)) });
      continue;
    }

    // paragraph: runs until a blank line or the start of another block
    const para: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i], lines[i + 1])) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({ t: "p", c: parseInline(para.map((l) => l.trim()).join("\n")) });
  }
  return blocks;
}

export function parseMarkdown(text: string): Block[] {
  return parseBlocks(text.replace(/\r\n?/g, "\n").split("\n"));
}

/** Plain text of an inline run (used by tests and for accessible labels). */
export function inlineText(c: Inline[]): string {
  return c
    .map((n) =>
      n.t === "text" || n.t === "code" ? n.v : n.t === "br" ? "\n" : n.t === "cite" ? `[${n.id}]` : inlineText(n.c)
    )
    .join("");
}
