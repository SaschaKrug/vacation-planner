import { type ReactNode } from "react";

// A small Markdown renderer for the assistant's answers: paragraphs, headings, lists, code,
// bold, italics, links. It builds React elements (never HTML), so model output can't inject
// markup; links only open http(s) URLs.

const INLINE =
  /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|\[[^\]]+\]\([^)\s]+\)|https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

function safeHref(url: string): string | undefined {
  return /^https?:\/\//i.test(url) ? url : undefined;
}

function inline(text: string, key = ""): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const s = m[0];
    if (m.index! > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (s.startsWith("`")) {
      out.push(
        <code key={k} className="rounded bg-muted px-1 py-0.5 text-[0.85em]">
          {s.slice(1, -1)}
        </code>,
      );
    } else if (s.startsWith("**") || s.startsWith("__")) {
      out.push(<strong key={k}>{inline(s.slice(2, -2), k)}</strong>);
    } else if (s.startsWith("*") || s.startsWith("_")) {
      out.push(<em key={k}>{inline(s.slice(1, -1), k)}</em>);
    } else if (s.startsWith("[")) {
      const [, label, url] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(s)!;
      const href = safeHref(url);
      out.push(
        href
          ? (
            <a
              key={k}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2"
            >
              {label}
            </a>
          )
          : label,
      );
    } else {
      out.push(
        <a
          key={k}
          href={s}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-primary underline underline-offset-2"
        >
          {s.replace(/^https?:\/\//, "")}
        </a>,
      );
    }
    last = m.index! + s.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const k = `b${i}`;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].startsWith("```"); i++) code.push(lines[i]);
      i++;
      blocks.push(
        <pre
          key={k}
          className="overflow-x-auto rounded-md bg-muted p-2 text-xs"
        ><code>{code.join("\n")}</code></pre>,
      );
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(<p key={k} className="font-semibold">{inline(heading[2], k)}</p>);
      i++;
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items: ReactNode[] = [];
      for (; i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i]); i++) {
        items.push(
          <li key={i}>{inline(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, ""), `${k}-${i}`)}</li>,
        );
      }
      blocks.push(
        ordered
          ? <ol key={k} className="list-decimal space-y-0.5 pl-5">{items}</ol>
          : <ul key={k} className="list-disc space-y-0.5 pl-5">{items}</ul>,
      );
      continue;
    }
    const para: string[] = [];
    for (
      ;
      i < lines.length && lines[i].trim() && !/^(```|#{1,4}\s|\s*([-*•]|\d+[.)])\s)/.test(lines[i]);
      i++
    ) {
      para.push(lines[i]);
    }
    blocks.push(
      <p key={k}>
        {para.flatMap((
          p,
          j,
        ) => (j ? [<br key={`br${j}`} />, ...inline(p, `${k}-${j}`)] : inline(p, `${k}-${j}`)))}
      </p>,
    );
  }
  return <div className="space-y-2 leading-relaxed [overflow-wrap:anywhere]">{blocks}</div>;
}
