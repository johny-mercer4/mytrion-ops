import { useEffect, useState } from 'react';
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
      <span className="an-file-icon"><Icon name="attach_file" /></span>
      <span className="an-file-name">{name}</span>
      <Button size="sm" variant="secondary" loading={busy} onClick={() => void download()}>
        <Icon name="download" size="sm" /> Download
      </Button>
      {error ? <span className="an-asset-error">Download failed</span> : null}
    </div>
  );
}

export function AnnouncementContent({ text }: { text: string }) {
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
