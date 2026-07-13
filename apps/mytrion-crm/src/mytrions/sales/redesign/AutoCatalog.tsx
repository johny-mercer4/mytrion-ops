/**
 * Automations catalog grid — category sections with icons, HTML5 drag-and-drop reorder,
 * order persisted via autoCatalogOrder (per-agent localStorage).
 */
import { useState, type DragEvent } from 'react';
import { s, Svg } from './dc';
import { deptStyle, iconBox } from './salesData';
import type { Automation } from './autoLive';
import {
  groupCatalog,
  loadCatalogOrder,
  moveIdBefore,
  saveCatalogOrder,
  type AutoCategory,
} from './autoCatalogOrder';

const DEPT_COL: Record<string, string> = {
  C: 'var(--orange)',
  Q: 'var(--accent)',
  V: 'var(--ok)',
  M: 'var(--violet)',
};

const catalogCard = (soon: boolean, dragging: boolean): string =>
  `text-align:left;padding:18px;border-radius:16px;background:var(--surface);border:1px solid ${dragging ? 'var(--accent)' : 'var(--border)'};cursor:${soon ? 'default' : 'grab'};box-shadow:${dragging ? '0 12px 32px rgba(0,0,0,0.15)' : 'var(--shadow-sm)'};transform:${dragging ? 'scale(1.02)' : 'scale(1)'};position:relative;overflow:hidden;opacity:${soon ? 0.55 : dragging ? 0.95 : 1};width:100%;display:flex;flex-direction:column;gap:12px;transition:all .2s cubic-bezier(0.2, 0, 0, 1)`;

function CategoryHeader({ category, count }: { category: AutoCategory; count: number }) {
  return (
    <div style={s('display:flex;align-items:center;gap:12px;margin:8px 0 14px')}>
      <div style={s(iconBox(category.color, 38))}>
        <Svg d={category.icon} size={20} strokeWidth={2} />
      </div>
      <div style={s('flex:1;min-width:0')}>
        <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:17px;letter-spacing:.04em;text-transform:uppercase;color:var(--text)')}>
          {category.label}
        </div>
        <div style={s('font-size:12px;color:var(--muted);margin-top:2px')}>
          {count} action{count === 1 ? '' : 's'}
        </div>
      </div>
    </div>
  );
}

export function AutoCatalog({
  items,
  onOpen,
}: {
  items: readonly Automation[];
  onOpen: (a: Automation) => void;
}) {
  const [order, setOrder] = useState<string[]>(() => loadCatalogOrder());
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const sections = groupCatalog(items, order);

  const onDragStart = (id: string, e: DragEvent) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };

  const onDragOver = (id: string, e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (overId !== id) setOverId(id);
  };

  const onDrop = (id: string, e: DragEvent) => {
    e.preventDefault();
    const from = e.dataTransfer.getData('text/plain') || dragId;
    if (!from) return;
    const next = moveIdBefore(order, from, id);
    setOrder(next);
    saveCatalogOrder(next);
    setDragId(null);
    setOverId(null);
  };

  const onDragEnd = () => {
    setDragId(null);
    setOverId(null);
  };

  if (items.length === 0) {
    return (
      <div style={s('text-align:center;padding:56px 20px;color:var(--muted)')}>
        <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:17px;text-transform:uppercase;color:var(--text)')}>
          No actions match your search
        </div>
        <div style={s('font-size:13px;margin-top:5px')}>
          Try a code like <strong style={s('color:var(--text2)')}>C-16</strong> or a keyword like{' '}
          <strong style={s('color:var(--text2)')}>fraud</strong>.
        </div>
      </div>
    );
  }

  return (
    <div style={s('display:flex;flex-direction:column;gap:22px')}>
      <div style={s('font-size:11.5px;color:var(--muted)')}>
        Drag blocks to set your preferred order — saved on this device.
      </div>
      {sections.map(({ category, items: sectionItems }) => (
        <section key={category.code}>
          <CategoryHeader category={category} count={sectionItems.length} />
          <div style={s('display:grid;grid-template-columns:repeat(3,1fr);gap:14px')}>
            {sectionItems.map((a) => {
              const dragging = dragId === a.id;
              const over = overId === a.id && dragId !== a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  draggable={!a.soon}
                  onDragStart={(e) => onDragStart(a.id, e)}
                  onDragOver={(e) => onDragOver(a.id, e)}
                  onDrop={(e) => onDrop(a.id, e)}
                  onDragEnd={onDragEnd}
                  onClick={() => onOpen(a)}
                  className="ss-card-h"
                  style={s(
                    `${catalogCard(!!a.soon, dragging)};${over ? 'outline:2px solid var(--accent);outline-offset:2px' : ''}`,
                  )}
                >
                  <div style={s('display:flex;align-items:flex-start;justify-content:space-between;gap:8px')}>
                    <div style={s(iconBox(DEPT_COL[a.dept] ?? 'var(--accent)', 42))}>
                      <Svg d={a.icon} size={21} strokeWidth={1.8} />
                    </div>
                    <div style={s('display:flex;align-items:center;gap:6px')}>
                      {a.soon && (
                        <span style={s('font-size:9px;font-weight:800;letter-spacing:.05em;padding:3px 8px;border-radius:99px;background:var(--raised);color:var(--muted)')}>
                          SOON
                        </span>
                      )}
                      {!a.soon && (
                        <span
                          aria-hidden
                          title="Drag to reorder"
                          style={s('font-size:14px;color:var(--muted);line-height:1;cursor:grab;user-select:none')}
                        >
                          ⋮⋮
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div style={s('font-size:14px;font-weight:700')}>{a.title}</div>
                    <div style={s('display:flex;gap:5px;margin-top:6px;flex-wrap:wrap')}>
                      {a.codes.map((c) => (
                        <span key={c} style={s(deptStyle(c))}>{c}</span>
                      ))}
                    </div>
                    <div style={s('font-size:12px;color:var(--muted);margin-top:8px;line-height:1.45')}>{a.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
