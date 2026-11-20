// Run:  node --experimental-strip-types --test tests/     (Node 22.6+; no dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { parseMarkdown, parseInline, inlineText } from "../src/markdown.ts";

const kinds = (blocks) => blocks.map((b) => b.t);

test("paragraphs, headings and line breaks", () => {
  const b = parseMarkdown("## Mức phạt\n\nDòng một\ndòng hai\n\nĐoạn hai");
  assert.deepEqual(kinds(b), ["h", "p", "p"]);
  assert.equal(b[0].level, 2);
  assert.deepEqual(b[1].c.map((n) => n.t), ["text", "br", "text"]);
});

test("bold, italic, strike, code, nested", () => {
  const c = parseInline("**đậm** và *nghiêng* và ~~gạch~~ và `code` và **a *b* c**");
  assert.deepEqual(c.filter((n) => n.t !== "text").map((n) => n.t), ["bold", "italic", "strike", "code", "bold"]);
  assert.equal(inlineText(c), "đậm và nghiêng và gạch và code và a b c");
});

test("unclosed markers stay literal while streaming", () => {
  assert.equal(inlineText(parseInline("giá **138 triệu")), "giá **138 triệu");
  assert.equal(inlineText(parseInline("giá `code")), "giá `code");
  assert.equal(inlineText(parseInline("2 * 3 * 4")), "2 * 3 * 4");
  assert.equal(inlineText(parseInline("file_name_here và snake_case")), "file_name_here và snake_case");
});

test("citation markers become cite nodes, links only when safe", () => {
  const c = parseInline("Lương là 5 triệu [1][2]. Xem [trang](https://a.vn/x) và [bẫy](javascript:alert(1))");
  assert.deepEqual(c.filter((n) => n.t === "cite").map((n) => n.id), [1, 2]);
  const links = c.filter((n) => n.t === "link");
  assert.equal(links.length, 1);
  assert.equal(links[0].href, "https://a.vn/x");
  assert.ok(!JSON.stringify(c).includes("javascript:alert"), "unsafe href must not survive as a link");
});

test("bare urls become links without trailing punctuation", () => {
  const c = parseInline("Xem https://sjc.com.vn/gia-vang.");
  const l = c.find((n) => n.t === "link");
  assert.equal(l.href, "https://sjc.com.vn/gia-vang");
});

test("bullet and numbered lists, nested", () => {
  const b = parseMarkdown("- một\n- hai\n  - hai.một\n  - hai.hai\n- ba\n\n1. x\n2. y");
  assert.deepEqual(kinds(b), ["list", "list"]);
  assert.equal(b[0].items.length, 3);
  assert.equal(b[0].ordered, false);
  const nested = b[0].items[1].find((x) => x.t === "list");
  assert.equal(nested.items.length, 2);
  assert.equal(b[1].ordered, true);
  assert.equal(b[1].items.length, 2);
});

test("a numbered list keeps its start and survives blank lines between items", () => {
  const b = parseMarkdown("3. ba\n\n4. bốn");
  assert.equal(b.length, 1);
  assert.equal(b[0].start, 3);
  assert.equal(b[0].items.length, 2);
});

test("code fences, also while still open", () => {
  const closed = parseMarkdown("```python\nprint(1)\n```\nsau");
  assert.deepEqual(kinds(closed), ["code", "p"]);
  assert.equal(closed[0].lang, "python");
  assert.equal(closed[0].open, false);
  const open = parseMarkdown("```\nđang gõ");
  assert.equal(open[0].open, true);
  assert.equal(open[0].v, "đang gõ");
});

test("tables with alignment; a header without its separator is just text", () => {
  const b = parseMarkdown("| Vùng | Mức |\n|:--|--:|\n| I | 4.960.000 |\n| II | 4.410.000 |");
  assert.equal(b[0].t, "table");
  assert.deepEqual(b[0].align, ["left", "right"]);
  assert.equal(b[0].rows.length, 2);
  assert.equal(inlineText(b[0].rows[1][1]), "4.410.000");
  assert.equal(kinds(parseMarkdown("| Vùng | Mức |"))[0], "p");
});

test("quotes, rules and a heading right after a paragraph", () => {
  const b = parseMarkdown("> trích dẫn\n> tiếp\n\n---\n\nđoạn\n# Tiêu đề");
  assert.deepEqual(kinds(b), ["quote", "hr", "p", "h"]);
});

test("html is never interpreted: it stays text", () => {
  const b = parseMarkdown("<script>alert(1)</script> <img src=x onerror=alert(1)>");
  assert.equal(b[0].t, "p");
  assert.ok(b[0].c.every((n) => n.t === "text"));
});

test("any prefix of a rich answer parses without throwing", () => {
  const doc = "## Kết quả\n\n**Mức phạt** từ 1–2 triệu [1].\n\n- ý một\n- ý hai\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nx\n```\n> hết";
  for (let i = 0; i <= doc.length; i++) parseMarkdown(doc.slice(0, i));
});
