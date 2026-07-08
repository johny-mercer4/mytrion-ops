import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Markdown } from './Markdown';

describe('Markdown sanitization', () => {
  it('neutralizes script tags', () => {
    const { container } = render(<Markdown text={'hello <script>alert(1)</script> world'} />);
    expect(container.querySelector('script')).toBeNull();
  });

  it('neutralizes img onerror payloads', () => {
    const { container } = render(<Markdown text={'<img src=x onerror="alert(1)">'} />);
    expect(container.querySelector('img')).toBeNull();
  });

  it('drops javascript: hrefs', () => {
    const { container } = render(<Markdown text={'[click](javascript:alert(1))'} />);
    const a = container.querySelector('a');
    expect(a?.getAttribute('href') ?? '').not.toMatch(/^javascript:/i);
  });

  it('renders safe links with target=_blank + noopener', () => {
    const { container } = render(<Markdown text={'[docs](https://example.com)'} />);
    const a = container.querySelector('a');
    expect(a).toHaveAttribute('href', 'https://example.com');
    expect(a).toHaveAttribute('target', '_blank');
    expect(a?.getAttribute('rel')).toContain('noopener');
  });
});

describe('Markdown rendering', () => {
  it('renders GFM tables', () => {
    const { container } = render(<Markdown text={'| a | b |\n| - | - |\n| 1 | 2 |'} />);
    expect(container.querySelector('table')).not.toBeNull();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('renders fenced code with the language class preserved', () => {
    const { container } = render(<Markdown text={'```ts\nconst x = 1;\n```'} />);
    const code = container.querySelector('code');
    expect(code?.className).toContain('language-ts');
  });

  it('renders lists', () => {
    const { container } = render(<Markdown text={'- one\n- two'} />);
    expect(container.querySelectorAll('li')).toHaveLength(2);
  });
});
