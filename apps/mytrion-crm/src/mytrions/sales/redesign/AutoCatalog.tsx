/**
 * Automations catalog grid — category sections with icons, HTML5 drag-and-drop reorder,
 * order persisted via autoCatalogOrder (per-agent localStorage).
 */
import { useState, type DragEvent } from 'react';
import { s } from './dc';
import { Icon } from './icons';
import { deptStyle, iconBox } from './salesData';
import { autoIconColor, type Automation } from './autoLive';
import {
  groupCatalog,
  loadCatalogOrder,
  moveIdBefore,
  saveCatalogOrder,
  type AutoCategory,
} from './autoCatalogOrder';
import { AutoEmptyState } from './AutoActionResult';

/**
 * Catalog card style.
 *
 * Three things here are deliberate, because together they were making the card's CONTENT vanish
 * while hovering and scrolling the grid:
 *
 *  - `transform` is emitted ONLY while dragging. A permanent `scale(1)` is not a no-op: it promotes
 *    the card to its own composited layer and makes it a containing block for its children. Stacked
 *    on the `backdrop-filter: blur(20px)` that `.ss-card-h` puts on every one of these cards, a
 *    scroll that changes what the filter samples could leave the promoted layer un-repainted — the
 *    children were still there, just not painted.
 *  - `overflow: hidden` is gone. Nothing in the card overflows (icon box, SOON pill, drag handle,
 *    title, code chips, description are all normal flow), so it bought nothing and gave that stale
 *    layer something to clip against.
 *  - `transition: all` is now an explicit property list. `all` re-runs the transition machinery for
 *    every changed property — including ones that force the blur layer to re-rasterise — and it was
 *    also overriding the narrower transition `.ss-card-h` sets in ss-horizon.css.
 *
 * Rest appearance is unchanged; the drag scale still animates (from `none`, which interpolates).
 */
const catalogCard = (soon: boolean, dragging: boolean): string =>
  `text-align:left;padding:18px;border-radius:var(--radius-md);background:var(--surface);border:1px solid ${dragging ? 'var(--accent)' : 'var(--border)'};cursor:${soon ? 'default' : 'grab'};box-shadow:${dragging ? '0 12px 32px rgba(0,0,0,0.15)' : 'var(--shadow-sm)'};${dragging ? 'transform:scale(1.02);' : ''}position:relative;opacity:${soon ? 0.55 : dragging ? 0.95 : 1};width:100%;display:flex;flex-direction:column;gap:12px;transition:box-shadow .2s cubic-bezier(0.2,0,0,1),border-color .2s cubic-bezier(0.2,0,0,1),transform .2s cubic-bezier(0.2,0,0,1),opacity .2s cubic-bezier(0.2,0,0,1)`;

function CategoryHeader({ category, count }: { category: AutoCategory; count: number }) {
  return (
    <div style={s('display:flex;align-items:center;gap:12px;margin:8px 0 14px')}>
      <div style={s(iconBox(category.color, 38))}>
        <Icon name={category.icon} size={18} strokeWidth={1.75} />
      </div>
      <div style={s('flex:1;min-width:0')}>
        <div style={s('font-family:var(--font-head);font-weight:700;font-size:var(--ss-text-md);letter-spacing:.04em;text-transform:uppercase;color:var(--text)')}>
          {category.label}
        </div>
        <div style={s('font-size:var(--ss-text-xs);color:var(--muted);margin-top:2px')}>
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
      <AutoEmptyState
        title="No actions match your search"
        message="Try a code like C-16 or a keyword like fraud."
        icon="search"
      />
    );
  }

  return (
    <div style={s('display:flex;flex-direction:column;gap:22px')}>
      <div style={s('font-size:var(--ss-text-xs);color:var(--muted)')}>
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
                    <div style={s(iconBox(autoIconColor(a), 42))}>
                      <Icon name={a.icon} size={20} strokeWidth={1.75} />
                    </div>
                    <div style={s('display:flex;align-items:center;gap:6px')}>
                      {a.soon && (
                        <span style={s('font-size:var(--ss-text-badge);font-weight:800;letter-spacing:.05em;padding:3px 8px;border-radius:var(--radius-full);background:var(--raised);color:var(--muted)')}>
                          SOON
                        </span>
                      )}
                      {!a.soon && (
                        <span
                          aria-hidden
                          title="Drag to reorder"
                          style={s('font-size:var(--ss-text-base);color:var(--muted);line-height:1;cursor:grab;user-select:none')}
                        >
                          ⋮⋮
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div style={s('font-size:var(--ss-text-base);font-weight:700')}>{a.title}</div>
                    <div style={s('display:flex;gap:5px;margin-top:6px;flex-wrap:wrap')}>
                      {a.codes.map((c) => (
                        <span key={c} style={s(deptStyle(c, autoIconColor(a)))}>{c}</span>
                      ))}
                    </div>
                    <div style={s('font-size:var(--ss-text-xs);color:var(--muted);margin-top:8px;line-height:1.45')}>{a.desc}</div>
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
