/**
 * Sanitized markdown for assistant answers. react-markdown never uses innerHTML and drops raw
 * HTML by default; rehype-sanitize pins that guarantee even if a raw-HTML plugin is ever added.
 * Rendered progressively during streaming — unclosed constructs look rough for a moment and
 * self-heal at completion (standard chat behavior).
 */
import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import styles from './Markdown.module.css';

// Keep the `language-*` class on code so a highlighter can hook in later.
const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.['code'] ?? []), ['className', /^language-./]],
  },
} as typeof defaultSchema;

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className={styles.md}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, schema]]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
