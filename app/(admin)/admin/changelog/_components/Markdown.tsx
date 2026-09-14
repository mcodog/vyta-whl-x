'use client';

import React from 'react';

/**
 * Small, dependency-free markdown renderer for changelog bodies. Supports a
 * pragmatic subset: `#`/`##`/`###` headings, `-`/`*` bullet lists, `1.` ordered
 * lists, `**bold**`, `*italic*`, `` `code` ``, and [links](url). Everything
 * else renders as plain paragraphs with line breaks preserved. Input is never
 * injected as raw HTML.
 */

/** Render inline markdown (bold / italic / code / links) within a line. */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Match, in order: links, bold, italic, inline code.
  const pattern = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const key = `${keyPrefix}-${i++}`;
    if (match[1] !== undefined) {
      const href = match[2];
      const safe = /^(https?:|mailto:|\/)/i.test(href) ? href : '#';
      nodes.push(
        <a
          key={key}
          href={safe}
          target={safe.startsWith('http') ? '_blank' : undefined}
          rel="noopener noreferrer"
          className="text-vital underline underline-offset-2 hover:text-vital-dark"
        >
          {match[1]}
        </a>,
      );
    } else if (match[3] !== undefined) {
      nodes.push(<strong key={key} className="font-semibold text-ink">{match[3]}</strong>);
    } else if (match[4] !== undefined) {
      nodes.push(<em key={key}>{match[4]}</em>);
    } else if (match[5] !== undefined) {
      nodes.push(
        <code key={key} className="px-1 py-0.5 rounded bg-surface border border-line text-[0.85em] font-mono text-ink">
          {match[5]}
        </code>,
      );
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

export default function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];
  let listOrdered = false;
  let key = 0;

  const flushList = () => {
    if (listItems.length === 0) return;
    const items = listItems;
    if (listOrdered) {
      blocks.push(
        <ol key={`ol-${key++}`} className="list-decimal pl-5 space-y-1 my-2 text-sm text-ink-muted">
          {items}
        </ol>,
      );
    } else {
      blocks.push(
        <ul key={`ul-${key++}`} className="list-disc pl-5 space-y-1 my-2 text-sm text-ink-muted">
          {items}
        </ul>,
      );
    }
    listItems = [];
  };

  lines.forEach((rawLine, idx) => {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (trimmed === '') {
      flushList();
      return;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushList();
      const level = heading[1].length;
      const content = renderInline(heading[2], `h-${idx}`);
      const cls =
        level === 1
          ? 'text-base font-bold text-ink mt-4 mb-2'
          : level === 2
            ? 'text-sm font-bold text-ink mt-4 mb-1.5'
            : 'text-sm font-semibold text-ink mt-3 mb-1';
      blocks.push(
        React.createElement(`h${Math.min(level + 2, 6)}`, { key: `h-${key++}`, className: cls }, content),
      );
      return;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      if (listOrdered) flushList();
      listOrdered = false;
      listItems.push(<li key={`li-${idx}`}>{renderInline(bullet[1], `li-${idx}`)}</li>);
      return;
    }

    const ordered = /^\d+\.\s+(.*)$/.exec(trimmed);
    if (ordered) {
      if (!listOrdered) flushList();
      listOrdered = true;
      listItems.push(<li key={`li-${idx}`}>{renderInline(ordered[1], `li-${idx}`)}</li>);
      return;
    }

    flushList();
    blocks.push(
      <p key={`p-${key++}`} className="text-sm text-ink-muted leading-relaxed my-2">
        {renderInline(trimmed, `p-${idx}`)}
      </p>,
    );
  });

  flushList();

  return <div className="changelog-markdown">{blocks}</div>;
}
