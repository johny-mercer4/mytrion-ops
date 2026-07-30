import { ArrowRight, ListTodo } from 'lucide-react';
import { useUserContext } from '../../context/UserContextProvider';
import {
  accessibleManagerCards,
  accessibleManagerDepartments,
  type ManagerCardId,
  type ManagerDepartmentId,
} from './managerNav';

/**
 * Manager Overview — the hub. Two blocks:
 *
 *   Workspaces   tools that exist and open into a real surface (today: Referrals)
 *   Departments  a jump grid to each department landing, mirroring the sidebar group
 *
 * Layer-2 RBAC is already applied by the `accessible*` selectors, so anything rendered here is
 * something this user may actually open.
 */
export function ManagerHome({
  onOpenCard,
  onOpenDepartment,
}: {
  onOpenCard: (id: ManagerCardId) => void;
  onOpenDepartment: (id: ManagerDepartmentId) => void;
}) {
  const user = useUserContext();
  const cards = accessibleManagerCards(user);
  const departments = accessibleManagerDepartments(user);
  const firstName = user.userName.split(' ')[0] || user.userName;

  return (
    <div className="mg-page mg-home">
      <header className="mg-hero">
        <div className="mg-hero-glow" aria-hidden="true" />
        <div className="mg-hero-inner">
          <div className="mg-kicker">Manager workspace</div>
          <h1 className="mg-hero-title">
            Good to see you, <span>{firstName}</span>
          </h1>
          <p className="mg-hero-sub">
            Operational tools and records across Octane. Open a workspace below, or jump to the
            department you oversee.
          </p>
        </div>
      </header>

      {cards.length === 0 && departments.length === 0 ? (
        <div className="mg-empty">Nothing is available for your access level yet.</div>
      ) : null}

      {cards.length > 0 ? (
        <section className="mg-section">
          <div className="mg-section-head">
            <h2 className="mg-section-title">Workspaces</h2>
            <span className="mg-section-line" aria-hidden="true" />
            <span className="mg-section-count">{cards.length} live</span>
          </div>
          <div className="mg-card-grid">
            {cards.map((card) => {
              const Icon = card.icon;
              return (
                <button
                  key={card.id}
                  type="button"
                  className="mg-card"
                  style={{ ['--mg-tone' as string]: card.tone }}
                  onClick={() => onOpenCard(card.id)}
                  data-od-id={`manager-card-${card.id}`}
                >
                  <span className="mg-card-shimmer" aria-hidden="true" />
                  <span className="mg-card-top">
                    <span className="mg-card-glyph">
                      <Icon size={22} strokeWidth={1.9} />
                    </span>
                    <ArrowRight className="mg-card-arrow" size={15} strokeWidth={2.2} aria-hidden />
                  </span>
                  <span className="mg-card-title">{card.label}</span>
                  <span className="mg-card-desc">{card.description}</span>
                  <span className="mg-card-tag">{card.tag}</span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {departments.length > 0 ? (
        <section className="mg-section">
          <div className="mg-section-head">
            <h2 className="mg-section-title">Departments</h2>
            <span className="mg-section-line" aria-hidden="true" />
            <span className="mg-section-count">{departments.length} desks</span>
          </div>
          <div className="mg-dept-grid">
            {departments.map((dept) => {
              const Icon = dept.icon;
              return (
                <button
                  key={dept.id}
                  type="button"
                  className="mg-dept"
                  style={{ ['--mg-tone' as string]: dept.tone }}
                  onClick={() => onOpenDepartment(dept.id)}
                  data-od-id={`manager-dept-${dept.id}`}
                >
                  <span className="mg-dept-glyph">
                    <Icon size={18} strokeWidth={2} />
                  </span>
                  <span className="mg-dept-main">
                    <span className="mg-dept-title">{dept.label}</span>
                    <span className="mg-dept-desc">{dept.description}</span>
                  </span>
                  <span className="mg-dept-soon">
                    {dept.id === 'sales' ? null : (
                      <ListTodo size={11} strokeWidth={2.4} aria-hidden />
                    )}
                    {dept.id === 'sales' ? 'Coming soon' : 'Tasks'}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
