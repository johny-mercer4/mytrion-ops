import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  Briefcase,
  CalendarDays,
  Camera,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Send,
  ScanFace,
  User,
  X,
} from 'lucide-react';
import type { HrEmployeeDto } from '../../api/hr';
import { clearHrEmployeePhoto, setHrEmployeePhoto } from '../../api/hrPerson';
import { formatPhone } from '../../lib/phone';
import { resizeImageToDataUrl } from '../_shared/resizeImageDataUrl';
import { departmentTone } from './departmentAppearance';
import { HrAvatar } from './HrAvatar';
import { HrBusy, Pill, toneFor } from './HrBits';
import { HrZohoUserLink } from './HrZohoUserLink';
import { useModalFocus } from '../_shared/useModalFocus';

/**
 * Avatars render up to 64px here and on the org canvas, so 512 leaves room for a retina card without
 * shipping a 6MB phone photo: a 512px JPEG lands around 40–60KB, well inside the API's data-URL cap.
 */
const PHOTO_MAX_EDGE = 512;

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
  onPhotoChanged,
}: {
  employee: HrEmployeeDto;
  admin: boolean;
  /** Department tone token — colours the department badge to match its department card. */
  departmentColor?: string | null;
  onClose: () => void;
  onEdit: (e: HrEmployeeDto) => void;
  /** A photo was set or removed — the caller invalidates the directory so cards pick it up. */
  onPhotoChanged?: () => void;
}) {
  const name = `${employee.firstName} ${employee.lastName}`.trim();
  const handle = (employee.telegramUsername ?? '').trim().replace(/^@+/, '');
  const deptTone = departmentTone(departmentColor ?? null, employee.departmentId);
  /**
   * The photo is owned locally, not read from the prop, because it changes without the dialog closing.
   * The `employee` prop comes from the cached directory, which only refreshes after `onPhotoChanged`
   * lands — so reading the prop would show the old avatar (or none) until the modal was reopened.
   */
  const [photoFileId, setPhotoFileId] = useState<string | null>(employee.photoFileId);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Follow the prop when the dialog is pointed at a DIFFERENT person (the org canvas reuses this
  // instance), but not on every re-render, which would clobber a fresh upload with the cached value.
  useEffect(() => {
    setPhotoFileId(employee.photoFileId);
    setPhotoError('');
  }, [employee.id, employee.photoFileId]);

  const changePhoto = async (file: File | null): Promise<void> => {
    if (!file || photoBusy) return;
    setPhotoBusy(true);
    setPhotoError('');
    try {
      const dataUrl = await resizeImageToDataUrl(file, { maxEdge: PHOTO_MAX_EDGE });
      const row = await setHrEmployeePhoto(employee.id, dataUrl);
      setPhotoFileId(row.photoFileId);
      onPhotoChanged?.();
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : String(err));
    } finally {
      setPhotoBusy(false);
      // Clear the input, or picking the SAME file again fires no change event and looks like a no-op.
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removePhoto = async (): Promise<void> => {
    if (photoBusy) return;
    setPhotoBusy(true);
    setPhotoError('');
    try {
      const row = await clearHrEmployeePhoto(employee.id);
      setPhotoFileId(row.photoFileId);
      onPhotoChanged?.();
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : String(err));
    } finally {
      setPhotoBusy(false);
    }
  };
  /**
   * `aria-modal="true"` below is a promise: focus moves in, Tab cannot leave, focus comes back on close.
   * Without this the card that opened the dialog kept focus behind the backdrop and Tab walked the grid
   * underneath. Close is the right landing spot here — nothing in a read-only dialog is a field.
   */
  const dialogRef = useModalFocus<HTMLDivElement>();

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
        /* Focusable programmatically only, so the trap can pull focus back off <body> when a click
           lands on non-focusable content such as the heading. */
        tabIndex={-1}
        ref={dialogRef}
        style={
          {
            ['--dc' as string]: deptTone,
            // Stops a wheel past the end of the modal's own scroll area chaining to the grid behind it.
            overscrollBehavior: 'contain',
          } as CSSProperties
        }
        onClick={(ev) => ev.stopPropagation()}
      >
        <header className="hr-empd-head">
          <div className="hr-empd-photo" data-busy={photoBusy ? 'on' : undefined}>
            <HrAvatar name={name} employeeId={employee.id} photoFileId={photoFileId} size="lg" />
            {admin ? (
              <>
                <button
                  type="button"
                  className="hr-empd-photo-btn"
                  disabled={photoBusy}
                  title={photoFileId ? 'Change photo' : 'Upload photo'}
                  aria-label={
                    photoFileId ? `Change ${name}'s photo` : `Upload a photo for ${name}`
                  }
                  onClick={() => fileRef.current?.click()}
                >
                  <Camera size={13} />
                </button>
                {/*
                  `hidden` keeps this out of the modal's Tab cycle for free — useModalFocus filters on
                  `offsetParent`, so the camera button above is the single keyboard affordance rather
                  than a stop on an invisible input.
                */}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  onChange={(ev) => void changePhoto(ev.target.files?.[0] ?? null)}
                />
              </>
            ) : null}
          </div>
          <div className="hr-empd-ident">
            <h2 id="hr-empd-title">{name}</h2>
            <p>{employee.designation ?? '—'}</p>
            <span className="hr-empd-badges">
              <Pill label={employee.status} tone={toneFor(employee.status)} />
              {employee.department ? <span className="hr-empc-dept">{employee.department}</span> : null}
            </span>
            {admin ? (
              <span className="hr-empd-photo-actions">
                {photoBusy ? (
                  <HrBusy label={photoFileId ? 'Saving photo…' : 'Removing photo…'} />
                ) : (
                  <>
                    <button type="button" onClick={() => fileRef.current?.click()}>
                      {photoFileId ? 'Change photo' : 'Upload photo'}
                    </button>
                    {photoFileId ? (
                      <button type="button" onClick={() => void removePhoto()}>
                        Remove
                      </button>
                    ) : null}
                  </>
                )}
              </span>
            ) : null}
          </div>
          <button type="button" className="hr-icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        {photoError ? (
          <p className="hr-banner-error" role="alert">
            {photoError}
          </p>
        ) : null}

        <dl className="hr-empd-grid">
          <Field icon={<User size={12} />} label="Employee ID" value={employee.employeeId} mono />
          <Field
            icon={<ScanFace size={12} />}
            label="Face ID"
            value={employee.faceId}
            mono
          />
          <Field icon={<Mail size={12} />} label="Email" value={employee.email} mono />
          <Field icon={<Phone size={12} />} label="Mobile" value={formatPhone(employee.mobile)} mono />
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
          <>
            <HrZohoUserLink employee={employee} />
            <footer className="hr-modal-actions">
              <button type="button" className="hr-btn" onClick={onClose}>
                Close
              </button>
              <button type="button" className="hr-btn hr-btn-primary" onClick={() => onEdit(employee)}>
                <Pencil size={14} />
                Edit
              </button>
            </footer>
          </>
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
