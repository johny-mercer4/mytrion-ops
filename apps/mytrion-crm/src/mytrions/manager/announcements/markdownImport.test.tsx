import { describe, expect, it } from 'vitest';
import { markdownToAnnouncement } from './markdownImport';

describe('markdownToAnnouncement', () => {
  it('moves the first H1 into the announcement title and converts GFM content', () => {
    const imported = markdownToAnnouncement(
      '# **Quarter** update\n\n- First task\n- Second task\n\nSee [the plan](https://example.test).',
    );

    expect(imported.title).toBe('Quarter update');
    expect(imported.html).toContain('<ul>');
    expect(imported.html).toContain('<a href="https://example.test">the plan</a>');
    expect(imported.html).not.toContain('<h1>');
  });

  it('does not execute or preserve raw HTML from the Markdown file', () => {
    const imported = markdownToAnnouncement('<script>alert(1)</script>\n\nSafe copy');
    expect(imported.html).not.toContain('<script>');
    expect(imported.html).toContain('Safe copy');
  });
});
