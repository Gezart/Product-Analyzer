"use client";

import { Fragment, useMemo } from "react";
import { fillInParts } from "@/lib/fix-page";

// The description's HTML shown as the shop shows it, built as React elements from simple tags only (no
// raw HTML, attributes, links, images or scripts), with [fill in: …] parts highlighted.
const TAGS = {
  p: "p", div: "div", section: "div", article: "div", h1: "h3", h2: "h3", h3: "h3", h4: "h4", h5: "h4", h6: "h4",
  ul: "ul", ol: "ol", li: "li", blockquote: "blockquote", strong: "strong", b: "strong", em: "em", i: "em", u: "u",
  table: "table", thead: "thead", tbody: "tbody", tfoot: "tbody", tr: "tr", td: "td", th: "th",
};
const CLASSES = {
  p: "m-0 mb-2.5 last:mb-0",
  h3: "m-0 mb-2 text-[15px] font-bold",
  h4: "m-0 mb-2 font-bold",
  ul: "m-0 mb-2.5 list-disc pl-5 last:mb-0",
  ol: "m-0 mb-2.5 list-decimal pl-5 last:mb-0",
  li: "mb-1",
  blockquote: "m-0 mb-2.5 border-l-2 border-line pl-3 text-ink-2",
  div: "mb-2.5 last:mb-0",
  table: "mb-2.5 border-collapse text-[13px] last:mb-0",
  td: "border border-line px-2 py-1 align-top",
  th: "border border-line bg-head px-2 py-1 text-left align-top font-semibold",
};
const TABLE_PARTS = new Set(["table", "thead", "tbody", "tfoot", "tr"]);
const DROP = new Set(["script", "style", "iframe", "object", "embed", "template", "img", "svg", "video", "audio", "picture", "noscript"]);

function Text({ text }) {
  return fillInParts(text).map((part, i) =>
    part.fillIn ? (
      <mark key={i} className="rounded bg-[#FEF3C7] px-1 text-[#92400E]">
        {part.text}
      </mark>
    ) : (
      <Fragment key={i}>{part.text}</Fragment>
    ),
  );
}

function render(node, key) {
  if (node.nodeType === 3) {
    // Line breaks between table rows and cells aren't text (and can't sit inside a table).
    if (TABLE_PARTS.has(node.parentNode?.nodeName?.toLowerCase()) && !node.textContent.trim()) return null;
    return <Text key={key} text={node.textContent} />;
  }
  if (node.nodeType !== 1) return null;
  const tag = node.tagName.toLowerCase();
  // What the shop hides stays hidden here too.
  if (DROP.has(tag) || node.hidden || /display\s*:\s*none/i.test(node.getAttribute("style") ?? "")) return null;
  if (tag === "br") return <br key={key} />;
  const children = [...node.childNodes].map((child, i) => render(child, i));
  const El = TAGS[tag];
  if (!El) return <Fragment key={key}>{children}</Fragment>;
  return (
    <El key={key} className={CLASSES[El]}>
      {children}
    </El>
  );
}

export function DescriptionPreview({ html }) {
  const content = useMemo(() => {
    if (!html?.trim()) return null;
    if (typeof DOMParser === "undefined") return <Text text={html.replace(/<[^>]*>/g, " ")} />;
    // Parsing as an inert document runs nothing; only the text and the simple tags above are used.
    const body = new DOMParser().parseFromString(html, "text/html").body;
    if (!body.textContent.trim()) return null;
    return [...body.childNodes].map((child, i) => render(child, i));
  }, [html]);
  return (
    <div className="overflow-x-auto rounded-[10px] border border-line-strong px-4 py-3.5 leading-[1.6] text-ink [overflow-wrap:anywhere]">
      {content ?? <p className="m-0 text-muted">No description yet.</p>}
    </div>
  );
}
