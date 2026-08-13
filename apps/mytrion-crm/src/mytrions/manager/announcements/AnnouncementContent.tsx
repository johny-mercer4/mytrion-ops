import DOMPurify from 'dompurify';
import { useEffect, useMemo, useState } from 'react';
import { getAnnouncementAssetDownload } from '../../../api/announcements';
import { Button } from '../../../ds/Button/Button';
import { Icon } from '../../../ds/Icon/Icon';
import { Markdown } from '../../../features/chat/Markdown';
import './announcementContent.css';

type Alignment = 'left' | 'center' | 'right';
type ContentPart =
  | { kind: 'markdown'; text: string; align: Alignment }
  | { kind: 'image' | 'file'; fileId: string; name: string; align: Alignment };

const ASSET_LINE = /^\[\[(image|file):([^|\]]+)\|([^\]]+)\]\]$/;

function decodeName(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parsePlainBlock(text: string, align: Alignment): ContentPart[] {
  const parts: ContentPart[] = [];
  let markdown: string[] = [];
  const flush = (): void => {
    const value = markdown.join('\n').trim();
    if (value) parts.push({ kind: 'markdown', text: value, align });
    markdown = [];
  };
  for (const line of text.split('\n')) {
    const asset = line.trim().match(ASSET_LINE);
    if (!asset) {
      markdown.push(line);
      continue;
    }
    flush();
    parts.push({
      kind: asset[1] as 'image' | 'file',
      fileId: asset[2]!,
      name: decodeName(asset[3]!),
      align,
    });
  }
  flush();
  return parts;
}

export function parseAnnouncementContent(text: string): ContentPart[] {
  const parts: ContentPart[] = [];
  const lines = text.split('\n');
  let normal: string[] = [];
  const flushNormal = (): void => {
    parts.push(...parsePlainBlock(normal.join('\n'), 'left'));
    normal = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const alignment = lines[index]!.match(/^:::align-(left|center|right)\s*$/)?.[1] as
      | Alignment
      | undefined;
    if (!alignment) {
      normal.push(lines[index]!);
      continue;
    }
    flushNormal();
    const block: string[] = [];
    index += 1;
    while (index < lines.length && !/^:::\s*$/.test(lines[index]!)) {
      block.push(lines[index]!);
      index += 1;
    }
    parts.push(...parsePlainBlock(block.join('\n'), alignment));
  }
  flushNormal();
  return parts;
}

function isRichHtml(text: string): boolean {
  return /<(?:p|h[1-6]|ul|ol|blockquote|figure|table|hr)\b/i.test(text);
}

function durableAssetId(value: string | null): string | null {
  const match = value?.match(/^\/v1\/files\/([A-Za-z0-9_-]+)\/content$/);
  return match?.[1] ?? null;
}

function isImageAsset(name: string, mime: string): boolean {
  return mime.startsWith('image/') || /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(name);
}

function isTrustedAssetUrl(value: string): boolean {
  try {
    const url = new URL(value, window.location.origin);
    return ['http:', 'https:'].includes(url.protocol) || value.startsWith('data:image/');
  } catch {
    return false;
  }
}

export function sanitizeAnnouncementHtml(html: string): string {
  const sanitized = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed', 'script'],
    FORBID_ATTR: ['srcset', 'onerror', 'onclick', 'onload'],
  });
  const doc = new DOMParser().parseFromString(sanitized, 'text/html');

  for (const node of doc.body.querySelectorAll<HTMLElement>('[style]')) {
    const alignment = node.style.textAlign;
    node.removeAttribute('style');
    if (['left', 'center', 'right', 'justify'].includes(alignment))
      node.style.textAlign = alignment;
  }
  for (const link of doc.body.querySelectorAll<HTMLAnchorElement>('a')) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
  for (const image of doc.body.querySelectorAll<HTMLImageElement>('img')) {
    if (!/^\/v1\/files\/[A-Za-z0-9_-]+\/content$/.test(image.getAttribute('src') ?? '')) {
      image.remove();
    } else {
      image.loading = 'lazy';
    }
  }
  return doc.body.innerHTML;
}

function RichHtmlContent({ html }: { html: string }) {
  const [resolvedHtml, setResolvedHtml] = useState(html);

  useEffect(() => {
    let active = true;
    setResolvedHtml(html);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const nodes = Array.from(
      doc.body.querySelectorAll<HTMLImageElement | HTMLAnchorElement>('img, a'),
    );
    const assetIds = Array.from(
      new Set(
        nodes
          .map((node) =>
            durableAssetId(node.getAttribute(node instanceof HTMLImageElement ? 'src' : 'href')),
          )
          .filter((id): id is string => id != null),
      ),
    );
    if (assetIds.length === 0)
      return () => {
        active = false;
      };

    void Promise.all(
      assetIds.map(async (fileId) => {
        try {
          return [fileId, await getAnnouncementAssetDownload(fileId)] as const;
        } catch {
          return [fileId, null] as const;
        }
      }),
    ).then((entries) => {
      if (!active) return;
      const assets = new Map(entries);
      for (const node of nodes) {
        const attribute = node instanceof HTMLImageElement ? 'src' : 'href';
        const fileId = durableAssetId(node.getAttribute(attribute));
        if (!fileId) continue;
        const asset = assets.get(fileId);
        if (!asset || !isTrustedAssetUrl(asset.url)) {
          if (node instanceof HTMLImageElement) {
            const error = doc.createElement('span');
            error.className = 'an-asset-error';
            error.textContent = `Image unavailable: ${node.alt || 'uploaded image'}`;
            node.replaceWith(error);
          }
          continue;
        }
        if (node instanceof HTMLImageElement) {
          node.src = asset.url;
          continue;
        }
        if (isImageAsset(asset.name, asset.mime)) {
          const image = doc.createElement('img');
          image.className = 'an-content-image';
          image.src = asset.url;
          image.alt = node.textContent?.trim() || asset.name;
          image.loading = 'lazy';
          node.replaceWith(image);
        } else {
          node.href = asset.url;
        }
      }
      setResolvedHtml(doc.body.innerHTML);
    });
    return () => {
      active = false;
    };
  }, [html]);

  return (
    <div
      className="an-content an-content-html"
      // HTML is sanitized before this component; asset URLs come from the authenticated file API.
      dangerouslySetInnerHTML={{ __html: resolvedHtml }}
    />
  );
}

function ImageAsset({ fileId, name }: { fileId: string; name: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    void getAnnouncementAssetDownload(fileId)
      .then((asset) => {
        if (active) setUrl(asset.url);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [fileId]);

  if (error) return <span className="an-asset-error">Image unavailable: {name}</span>;
  if (!url) return <span className="an-image-loading">Loading image…</span>;
  return <img className="an-content-image" src={url} alt={name} loading="lazy" />;
}

function FileAsset({ fileId, name }: { fileId: string; name: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const download = async (): Promise<void> => {
    setBusy(true);
    setError(false);
    try {
      const asset = await getAnnouncementAssetDownload(fileId);
      window.open(asset.url, '_blank', 'noopener,noreferrer');
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="an-file-card">
      <span className="an-file-icon">
        <Icon name="attach_file" />
      </span>
      <span className="an-file-name">{name}</span>
      <Button size="sm" variant="secondary" loading={busy} onClick={() => void download()}>
        <Icon name="download" size="sm" /> Download
      </Button>
      {error ? <span className="an-asset-error">Download failed</span> : null}
    </div>
  );
}

export function AnnouncementContent({ text }: { text: string }) {
  const richHtml = useMemo(
    () => (isRichHtml(text) ? sanitizeAnnouncementHtml(text) : null),
    [text],
  );
  if (richHtml != null) {
    return <RichHtmlContent html={richHtml} />;
  }
  const parts = parseAnnouncementContent(text);
  return (
    <div className="an-content">
      {parts.map((part, index) => (
        <div className="an-content-part" data-align={part.align} key={`${part.kind}-${index}`}>
          {part.kind === 'markdown' ? <Markdown text={part.text} /> : null}
          {part.kind === 'image' ? <ImageAsset fileId={part.fileId} name={part.name} /> : null}
          {part.kind === 'file' ? <FileAsset fileId={part.fileId} name={part.name} /> : null}
        </div>
      ))}
    </div>
  );
}
