import type { ReactNode } from 'react';
import { LoaderCircle, X } from 'lucide-react';

export function RecruitHead({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="recruit-head">
      <div>
        <div className="recruit-eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className="recruit-head-actions">{actions}</div> : null}
    </header>
  );
}

export function RecruitLoader({ label }: { label: string }) {
  return (
    <div className="recruit-loader" role="status">
      <LoaderCircle aria-hidden="true" />
      <strong>{label}</strong>
      <small>Preparing the latest recruiting workspace data</small>
    </div>
  );
}

export function RecruitEmpty({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="recruit-empty">
      <span>{icon}</span>
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

export function RecruitModal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="recruit-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="recruit-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button type="button" className="recruit-icon-btn" onClick={onClose} aria-label="Close">
            <X size={19} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

export function RecruitError({ message }: { message: string }) {
  return message ? <div className="recruit-error">{message}</div> : null;
}
