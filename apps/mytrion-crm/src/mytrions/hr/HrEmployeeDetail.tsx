import { useEffect, type CSSProperties } from 'react';
import {
  Briefcase,
  CalendarDays,
  Fingerprint,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Send,
  User,
  X,
} from 'lucide-react';
import type { HrEmployeeDto } from '../../api/hr';
import { departmentTone } from './departmentAppearance';
import { HrAvatar } from './HrAvatar';
import { Pill, toneFor } from './HrBits';

/**
 * Read-only employee detail — what a card click opens.
 *
 * Separate from the admin edit form on purpose: everyone with HR access can LOOK at a colleague, while
 * changing a record is an admin action. Keeping them apart means the common case (find someone, read
 * their details) never renders a form full of inputs, and Edit is one deliberate click away for admins.
 *
 * `source` is not shown — it marks which rows the Zoho People sync still owns, which is operator
 * plumbing rather than something an HR user needs.
 */
export function HrEmployeeDetail({
  employee,
  admin,
  departmentColor,
  onClose,
  onEdit,
}: {
  employee: HrEmployeeDto;
  admin: boolean;
  /** Department tone token — colours the department badge to match its department card. */
  departmentColor?: string | null;
  onClose: () => void;
  onEdit: (e: HrEmployeeDto) => void;
}) {
  const name = `${employee.firstName} ${employee.lastName}`.trim();
  const handle = (employee.telegramUsername ?? '').trim().replace(/^@+/, '');
  const deptTone = departmentTone(departmentColor ?? null);

  // Escape closes it. A modal you can only dismiss with the mouse is a trap for keyboard users.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="hr-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="hr-modal hr-empd"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hr-empd-title"
        style={{ ['--dc' as string]: deptTone } as CSSProperties}
        onClick={(ev) => ev.stopPropagation()}
      >
        <header className="hr-empd-head">
          <HrAvatar name={name} photoUrl={employee.photoUrl} size="lg" />
          <div className="hr-empd-ident">
            <h2 id="hr-empd-title">{name}</h2>
            <p>{employee.designation ?? '—'}</p>
            <span className="hr-empd-badges">
              <Pill label={employee.status} tone={toneFor(employee.status)} />
              {employee.department ? <span className="hr-empc-dept">{employee.department}</span> : null}
            </span>
          </div>
          <button type="button" className="hr-icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <dl className="hr-empd-grid">
          <Field icon={<User size={12} />} label="Employee ID" value={employee.employeeId} mono />
          <Field
            icon={<Fingerprint size={12} />}
            label="Face ID"
            value={employee.faceId}
            mono
          />
          <Field icon={<Mail size={12} />} label="Email" value={employee.email} mono />
          <Field icon={<Phone size={12} />} label="Mobile" value={employee.mobile} mono />
          {/* The '@' is presentation only — the column stores the bare handle. */}
          <Field
            icon={<Send size={12} />}
            label="Telegram"
            value={handle ? `@${handle}` : null}
            mono
            {...(handle ? { href: `https://t.me/${handle}` } : {})}
          />
          <Field icon={<Briefcase size={12} />} label="Role" value={employee.role} />
          <Field icon={<MapPin size={12} />} label="Location" value={employee.location} />
          <Field icon={<CalendarDays size={12} />} label="Joined" value={employee.dateOfJoining} mono />
          <Field icon={<User size={12} />} label="Reports to" value={employee.reportingTo} />
        </dl>

        {admin ? (
          <footer className="hr-modal-actions">
            <button type="button" className="hr-btn" onClick={onClose}>
              Close
            </button>
            <button type="button" className="hr-btn hr-btn-primary" onClick={() => onEdit(employee)}>
              <Pencil size={14} />
              Edit
            </button>
          </footer>
        ) : null}
      </div>
    </div>
  );
}

/** One labelled fact. Empty values render an em dash rather than vanishing, so the grid stays readable. */
function Field({
  icon,
  label,
  value,
  mono,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string | null;
  mono?: boolean;
  href?: string;
}) {
  const text = (value ?? '').trim();
  return (
    <div className="hr-empd-field">
      <dt>
        {icon}
        {label}
      </dt>
      <dd className={mono ? 'hr-mono' : undefined}>
        {text ? (
          href ? (
            <a href={href} target="_blank" rel="noreferrer">
              {text}
            </a>
          ) : (
            text
          )
        ) : (
          '—'
        )}
      </dd>
    </div>
  );
}
