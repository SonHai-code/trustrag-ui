import { useMemo } from "react";
import type { ReactNode } from "react";
import { parseMarkdown } from "./markdown";
import type { Block, Inline } from "./markdown";

/** Clickable [n] markers: only ids that are real sources become buttons, the rest stay as plain text. */
export interface CiteProps {
  cited: Set<number>;
  active: number | null;
  onCite: (id: number) => void;
}

function renderInline(nodes: Inline[], cite: CiteProps | undefined, key = ""): ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}${i}`;
    switch (n.t) {
      case "text":
        return n.v;
      case "br":
        return <br key={k} />;
      case "code":
        return <code key={k}>{n.v}</code>;
      case "bold":
        return <strong key={k}>{renderInline(n.c, cite, `${k}.`)}</strong>;
      case "italic":
        return <em key={k}>{renderInline(n.c, cite, `${k}.`)}</em>;
      case "strike":
        return <del key={k}>{renderInline(n.c, cite, `${k}.`)}</del>;
      case "link":
        return (
          <a key={k} href={n.href} target="_blank" rel="noopener noreferrer nofollow">
            {renderInline(n.c, cite, `${k}.`)}
          </a>
        );
      case "cite":
        if (cite && cite.cited.has(n.id)) {
          return (
            <button key={k} className={`cite ${cite.active === n.id ? "on" : ""}`} onClick={() => cite.onCite(n.id)}>
              {n.id}
            </button>
          );
        }
        return `[${n.id}]`;
    }
  });
}

function renderBlocks(blocks: Block[], cite: CiteProps | undefined, key = ""): ReactNode[] {
  return blocks.map((b, i) => {
    const k = `${key}${i}`;
    switch (b.t) {
      case "p":
        return <p key={k}>{renderInline(b.c, cite, `${k}.`)}</p>;
      case "h": {
        const Tag = `h${Math.min(6, b.level + 1)}` as "h2" | "h3" | "h4" | "h5" | "h6"; // the page's own h1/h2 stay above
        return <Tag key={k}>{renderInline(b.c, cite, `${k}.`)}</Tag>;
      }
      case "list": {
        const items = b.items.map((it, j) => <li key={j}>{renderBlocks(it, cite, `${k}.${j}.`)}</li>);
        return b.ordered ? (
          <ol key={k} start={b.start}>
            {items}
          </ol>
        ) : (
          <ul key={k}>{items}</ul>
        );
      }
      case "quote":
        return <blockquote key={k}>{renderBlocks(b.c, cite, `${k}.`)}</blockquote>;
      case "code":
        return (
          <pre key={k} className="md-code" data-lang={b.lang || undefined}>
            <code>{b.v}</code>
          </pre>
        );
      case "hr":
        return <hr key={k} />;
      case "table":
        return (
          <div key={k} className="md-table">
            <table>
              <thead>
                <tr>
                  {b.head.map((c, j) => (
                    <th key={j} style={{ textAlign: b.align[j] ?? undefined }}>
                      {renderInline(c, cite, `${k}.h${j}.`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((c, j) => (
                      <td key={j} style={{ textAlign: b.align[j] ?? undefined }}>
                        {renderInline(c, cite, `${k}.${r}.${j}.`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
    }
  });
}

/** Renders a model answer. No HTML is ever injected: the text is parsed into a tree and turned into React elements. */
export function Markdown({ text, cite, typing = false }: { text: string; cite?: CiteProps; typing?: boolean }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return <div className={`md${typing ? " typing" : ""}`}>{renderBlocks(blocks, cite)}</div>;
}
