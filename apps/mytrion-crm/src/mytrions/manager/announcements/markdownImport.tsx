import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export interface ImportedMarkdown {
  title: string | null;
  html: string;
}

function plainTitle(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`]/g, '')
    .trim();
}

/** Converts an uploaded article without enabling raw HTML from the source file. */
export function markdownToAnnouncement(source: string): ImportedMarkdown {
  const markdown = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = markdown.split('\n');
  const titleIndex = lines.findIndex((line) => /^#\s+\S/.test(line));
  const title = titleIndex >= 0 ? plainTitle(lines[titleIndex]!.replace(/^#\s+/, '')) : null;
  if (titleIndex >= 0) lines.splice(titleIndex, 1);

  const body = lines.join('\n').trim();
  const html = renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
      {body}
    </ReactMarkdown>,
  );
  return { title: title || null, html };
}
