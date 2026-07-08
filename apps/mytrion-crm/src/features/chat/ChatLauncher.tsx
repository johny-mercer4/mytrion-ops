import { useState } from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import type { UserContext } from '../../context/userContext';
import type { AgentKey } from '../../access/mytrions.config';
import { Dialog, DialogPortal } from '../../components/ui/dialog';
import { Gem } from '../../components/Gem';
import { ChatPanel } from './ChatPanel';
import styles from './ChatLauncher.module.css';

/**
 * The AI Chat entry point for every Mytrion: a floating icon (bottom-right, always on top of the
 * content — nothing else on the page ever loses width to it) that opens the chat as a modal.
 * `popoutHref` is forwarded so the modal can still offer "open in a new tab" for side-by-side use.
 *
 * Composes the raw base-ui Popup directly (skipping the shared `DialogContent`, which always
 * renders a dimmed/blurred `DialogOverlay`) — a corner chat widget shouldn't dim the whole page,
 * unlike every other (centered, record-detail) modal in the app. Outside-click/Escape dismissal
 * still works: that's handled by the Root, not the overlay's presence.
 */
export function ChatLauncher({
  context,
  department,
  agentKey,
  popoutHref,
}: {
  context: UserContext;
  department?: string | string[] | null;
  agentKey?: AgentKey | null;
  popoutHref?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={styles.launcher}
        aria-label="Open AI Chat"
        title="AI Chat"
        onClick={() => setOpen(true)}
      >
        <Gem size={24} />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPortal>
          <DialogPrimitive.Popup
            className={`${styles.content} fixed top-auto left-auto right-5 bottom-5 z-50 flex w-105 max-w-[calc(100vw-2rem)] translate-x-0 translate-y-0 origin-bottom-right flex-col gap-0 overflow-hidden rounded-xs bg-popover p-0 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none sm:max-w-105 h-[min(680px,80vh)]`}
          >
            <ChatPanel
              context={context}
              {...(department !== undefined ? { department } : {})}
              {...(agentKey !== undefined ? { agentKey } : {})}
              {...(popoutHref !== undefined ? { popoutHref } : {})}
              onClose={() => setOpen(false)}
            />
          </DialogPrimitive.Popup>
        </DialogPortal>
      </Dialog>
    </>
  );
}
