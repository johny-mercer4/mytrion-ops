import { useUserContext } from '../../context/UserContextProvider';
import { accessibleManagerCards, type ManagerCardId } from './managerNav';

/**
 * Manager hub landing — a "wizard" grid of card blocks. Each card opens its own page (Layer-2 RBAC
 * already applied via accessibleManagerCards). Mirrors the top-level Mytrion picker, one level down.
 */
export function ManagerHome({ onOpen }: { onOpen: (id: ManagerCardId) => void }) {
  const user = useUserContext();
  const cards = accessibleManagerCards(user);

  return (
    <div className="mg-home">
      <header className="mg-home-head">
        <h1 className="mg-home-title">Manager</h1>
        <p className="mg-home-sub">Operational tools and records. Choose a card to open its workspace.</p>
      </header>

      {cards.length === 0 ? (
        <div className="mg-empty">No cards are available for your access level.</div>
      ) : (
        <div className="mg-card-grid">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <button
                key={card.id}
                type="button"
                className="mg-card"
                onClick={() => onOpen(card.id)}
                data-od-id={`manager-card-${card.id}`}
              >
                <span className="mg-card-glyph">
                  <Icon size={22} strokeWidth={1.9} />
                </span>
                <span className="mg-card-tag">{card.tag}</span>
                <span className="mg-card-title">{card.label}</span>
                <span className="mg-card-desc">{card.description}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
