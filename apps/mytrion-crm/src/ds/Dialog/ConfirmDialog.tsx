import { useId, useRef, type ReactNode } from 'react';
import { Button } from '../Button/Button';
import { Icon } from '../Icon/Icon';
import { Dialog } from './Dialog';
import type { DialogCloseReason } from './useModalDialog';
import styles from './ConfirmDialog.module.css';

export type ConfirmTone = 'default' | 'danger';

export interface ConfirmDialogProps {
  /** Controlled, exactly as `Dialog`. */
  open: boolean;
  /** Escape, backdrop, the close button, and the cancel button all arrive here. */
  onClose: (reason: DialogCloseReason | 'cancel') => void;
  onConfirm: () => void;
  title: ReactNode;
  /** What the user is agreeing to. Name the consequence, not the mechanism. */
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * `default` — a normal, reversible decision.
   * `danger` — destructive or irreversible. Changes the confirm button, adds a warning glyph, and
   *   moves initial focus OFF the confirm button.
   */
  tone?: ConfirmTone;
  /** The confirm action is in flight. Keeps the dialog open and the button measured. */
  confirming?: boolean;
  className?: string;
}

/**
 * The one confirmation. Replaces two separate `ConfirmDialog` implementations plus the `window
 * .confirm()` calls that survived in three workspaces.
 *
 * It is `Dialog` with the decisions already made, which is the point: a confirm is the one dialog
 * shape whose details are all safety-critical and all easy to get wrong by hand.
 *
 * ROLE — `alertdialog`, not `dialog`. It interrupts to demand a decision rather than to present
 * content, and `aria-describedby` points at the body so the consequence is announced with the
 * title instead of waiting for the user to go looking for it.
 *
 * DESTRUCTIVE FOCUS — with `tone="danger"` initial focus goes to CANCEL, never to the destructive
 * button. Users confirm dialogs by reflex — Enter lands before the eye finishes the sentence — and
 * autofocusing "Delete" turns that reflex into data loss. With `tone="default"` the confirm button
 * takes focus, because there the reflex is correct and costs nothing to undo.
 *
 * TONE IS NEVER COLOUR ALONE — `danger` also carries a warning glyph beside the title and a
 * distinct button variant, so the severity survives greyscale, low vision and colour blindness.
 *
 * KEYBOARD
 *   Escape        cancel (reported with reason 'escape')
 *   Tab           cycles Cancel -> Confirm -> close button, trapped inside the dialog
 *   Enter/Space   activate the focused button — which, for a destructive confirm, is Cancel
 *
 * WHEN NOT TO USE IT
 * - A reversible action. Ship it with an undo affordance instead; a confirm on something undoable
 *   is friction that trains people to click through confirms that matter.
 * - A destructive action at scale ("delete 1,204 records"). Those want typed confirmation, which
 *   is a form — build it with `Dialog`.
 * - Collecting anything. The moment the user has to enter a value it is not a confirmation.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  confirming = false,
  className,
}: ConfirmDialogProps) {
  const bodyId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const danger = tone === 'danger';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      className={className}
      // See DESTRUCTIVE FOCUS above. This one line is the reason this component exists rather than
      // a documented convention that every call site would re-decide.
      initialFocusRef={danger ? cancelRef : confirmRef}
      role="alertdialog"
      aria-describedby={bodyId}
      title={
        <span className={styles.heading}>
          {danger ? (
            // The wrapper carries the class rather than the Icon: `IconProps.className` is
            // `string | undefined`-strict under exactOptionalPropertyTypes, and a span is also
            // where the optical alignment belongs.
            <span className={styles.glyph}>
              <Icon
                name="warning"
                size="sm"
                // Labelled, because it carries meaning the text does not: the title says what will
                // happen, the glyph says that it cannot be taken back.
                label="Destructive action"
              />
            </span>
          ) : null}
          {title}
        </span>
      }
      footer={
        <>
          <Button
            ref={cancelRef}
            variant="ghost"
            onClick={() => onClose('cancel')}
            // Cancel stays live while the confirm is in flight: if the request hangs, the escape
            // hatch must not be disabled along with everything else.
          >
            {cancelLabel}
          </Button>
          <Button
            ref={confirmRef}
            variant={danger ? 'danger' : 'primary'}
            loading={confirming}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className={styles.body} id={bodyId}>
        {body}
      </p>
    </Dialog>
  );
}
