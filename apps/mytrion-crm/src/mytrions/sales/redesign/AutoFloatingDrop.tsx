/**
 * Portal dropdown for Automations deal/card pickers — escapes modal overflow:hidden clipping.
 */
import { useEffect, useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { s } from './dc';

const panelBase =
  'position:fixed;z-index:200;border-radius:12px;background:var(--surface);border:1px solid var(--border);box-shadow:0 8px 28px rgba(15,23,42,.12),0 2px 8px rgba(15,23,42,.06);overflow:hidden;max-height:min(230px,42vh)';

export function AutoFloatingDrop({
  open,
  anchorRef,
  children,
  maxHeight = 230,
  onClose,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  maxHeight?: number;
  onClose?: () => void;
}) {
  const [box, setBox] = useState<{ top: number; left: number; width: number; flip: boolean } | null>(null);

  const measure = () => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const flip = spaceBelow < maxHeight + 12 && r.top > spaceBelow;
    setBox({
      top: flip ? r.top - 6 : r.bottom + 6,
      left: r.left,
      width: r.width,
      flip,
    });
  };

  useLayoutEffect(() => {
    if (!open) { setBox(null); return; }
    measure();
  }, [open, anchorRef, maxHeight]);

  useEffect(() => {
    if (!open) return;
    const onWin = () => measure();
    window.addEventListener('resize', onWin);
    window.addEventListener('scroll', onWin, true);
    return () => {
      window.removeEventListener('resize', onWin);
      window.removeEventListener('scroll', onWin, true);
    };
  }, [open, anchorRef, maxHeight]);

  useEffect(() => {
    if (!open || !onClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t)) return;
      if ((e.target as HTMLElement).closest?.('[role="listbox"]')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !box || typeof document === 'undefined') return null;

  const style = box.flip
    ? `${panelBase};left:${box.left}px;width:${box.width}px;bottom:${window.innerHeight - box.top}px;top:auto;max-height:${maxHeight}px;overflow-y:auto`
    : `${panelBase};left:${box.left}px;width:${box.width}px;top:${box.top}px;max-height:${maxHeight}px;overflow-y:auto`;

  return createPortal(
    <div className="ss-scroll" style={s(style)} role="listbox">
      {children}
    </div>,
    document.body,
  );
}
