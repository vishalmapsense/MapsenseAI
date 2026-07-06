import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import type { Components } from "react-markdown";

/* ------------------------------------------------------------------ */
/* Chip helper — renders inline-code as a coloured pill                */
/* ------------------------------------------------------------------ */
const isLikelyChip = (children: React.ReactNode): boolean => {
  if (typeof children === "string") return children.length < 80;
  if (Array.isArray(children))
    return children.length === 1 && typeof children[0] === "string" && (children[0] as string).length < 80;
  return false;
};

/* ------------------------------------------------------------------ */
/* Custom component map                                                 */
/* ------------------------------------------------------------------ */
const components: Components = {
  /* ── Headings ─────────────────────────────────────────────────────── */
  h1: ({ children }) => (
    <h1 className="text-lg font-bold mt-4 mb-2 text-foreground border-b border-border/50 pb-1.5 first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-base font-semibold mt-3 mb-1.5 text-foreground/90 first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold mt-2.5 mb-1 text-foreground/80 first:mt-0">
      {children}
    </h3>
  ),

  /* ── Paragraph ────────────────────────────────────────────────────── */
  p: ({ children }) => (
    <p className="text-[13px] leading-relaxed text-foreground/90 my-1.5 first:mt-0 last:mb-0">
      {children}
    </p>
  ),

  /* ── Bold & Italic ────────────────────────────────────────────────── */
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ children }) => (
    <em className="italic text-foreground/80">{children}</em>
  ),

  /* ── Strikethrough ────────────────────────────────────────────────── */
  del: ({ children }) => (
    <del className="line-through text-muted-foreground opacity-70">{children}</del>
  ),

  /* ── Horizontal Rule ──────────────────────────────────────────────── */
  hr: () => (
    <hr className="my-3 border-none h-px bg-gradient-to-r from-transparent via-border to-transparent" />
  ),

  /* ── Inline Code / Chip ───────────────────────────────────────────── */
  code: ({ className, children, ...props }) => {
    const isBlock = Boolean(className); // block code has a language class
    if (isBlock) {
      return (
        <code className={`${className ?? ""} text-[12px]`} {...props}>
          {children}
        </code>
      );
    }
    // inline: render as a colour-coded chip
    if (isLikelyChip(children)) {
      return (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[11.5px] font-mono font-medium bg-primary/10 text-primary border border-primary/20 leading-none">
          {children}
        </span>
      );
    }
    return (
      <code className="px-1 py-0.5 rounded text-[11.5px] font-mono bg-muted/60 text-foreground/90 border border-border/40">
        {children}
      </code>
    );
  },

  /* ── Block Code ───────────────────────────────────────────────────── */
  pre: ({ children }) => (
    <pre className="my-2 rounded-xl overflow-x-auto border border-border/40 bg-[#0d1117] text-[12px] leading-relaxed shadow-inner">
      {children}
    </pre>
  ),

  /* ── Blockquote ───────────────────────────────────────────────────── */
  blockquote: ({ children }) => (
    <blockquote className="my-2 pl-3 border-l-2 border-primary/60 bg-primary/5 rounded-r-lg py-1.5 pr-2 text-[12.5px] italic text-foreground/80">
      {children}
    </blockquote>
  ),

  /* ── Unordered List ───────────────────────────────────────────────── */
  ul: ({ children }) => (
    <ul className="my-1.5 pl-4 space-y-0.5 list-none">{children}</ul>
  ),
  li: ({ children, className }) => {
    // task-list items get a checkbox style from remark-gfm
    const isTask = className?.includes("task-list-item");
    return (
      <li
        className={`text-[13px] text-foreground/90 flex items-start gap-1.5 ${isTask ? "" : "before:content-['•'] before:text-primary/70 before:mt-0.5 before:shrink-0"}`}
      >
        <span>{children}</span>
      </li>
    );
  },

  /* ── Ordered List ─────────────────────────────────────────────────── */
  ol: ({ children }) => (
    <ol className="my-1.5 pl-4 space-y-0.5 list-decimal list-inside">{children}</ol>
  ),

  /* ── Table ────────────────────────────────────────────────────────── */
  table: ({ children }) => (
    <div className="my-2.5 overflow-x-auto rounded-xl border border-border/50 shadow-sm">
      <table className="w-full text-[12.5px] border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-muted/60 dark:bg-muted/30">{children}</thead>
  ),
  tbody: ({ children }) => (
    <tbody className="divide-y divide-border/30">{children}</tbody>
  ),
  tr: ({ children }) => (
    <tr className="hover:bg-muted/20 transition-colors">{children}</tr>
  ),
  th: ({ children }) => (
    <th className="px-3 py-2 text-left font-semibold text-foreground/90 border-b border-border/40 whitespace-nowrap">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2 text-foreground/80 align-top">{children}</td>
  ),

  /* ── Links ────────────────────────────────────────────────────────── */
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-2 hover:text-primary/80 transition-colors"
    >
      {children}
    </a>
  ),
};

/* ------------------------------------------------------------------ */
/* Public component                                                     */
/* ------------------------------------------------------------------ */
interface MarkdownRendererProps {
  content: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  return (
    <div className="markdown-body max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};
