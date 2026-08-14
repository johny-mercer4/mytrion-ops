import { useState } from 'react';
import { Inbox } from 'lucide-react';
import type { InboxMessage } from '../../../api/inbox';
import { VerificationCaseModal } from '../VerificationCaseModal';
import { useVerificationInbox } from '../verificationData';
import { caseIdFromInboxSource } from '../verificationCaseUi';

const SK_ITEMS = 5;

export function VerificationInbox() {
  const load = useVerificationInbox();
  const items = load.data ?? [];
  const firstLoad = load.loading && !load.data;
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="vf-clients">
      {load.error && items.length > 0 ? (
        <p className="vf-banner-error" role="alert">
          {load.error}
        </p>
      ) : null}

      {firstLoad ? (
        <div className="vf-sk-inbox" aria-busy="true">
          <span className="sr-only" role="status">
            Loading inbox
          </span>
          {Array.from({ length: SK_ITEMS }, (_, i) => (
            <div key={i} className="vf-sk vf-sk-inbox-item" aria-hidden="true" />
          ))}
        </div>
      ) : load.error && items.length === 0 ? (
        <div className="vf-empty" role="alert">
          <Inbox size={28} aria-hidden="true" />
          <div className="vf-empty-title">Couldn’t load inbox</div>
          <p>{load.error}</p>
          <button type="button" className="vf-btn" onClick={load.reload}>
            Try again
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="vf-empty">
          <Inbox size={28} aria-hidden="true" />
          <div className="vf-empty-title">No verification inbox messages yet</div>
          <p>New cases notify the verification queue owner.</p>
        </div>
      ) : (
        <ul className="vf-inbox">
          {items.map((item) => (
            <InboxRow key={item.id} item={item} onOpen={setOpenId} />
          ))}
        </ul>
      )}

      {openId ? <VerificationCaseModal caseId={openId} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}

function InboxRow({
  item,
  onOpen,
}: {
  item: InboxMessage;
  onOpen: (caseId: string) => void;
}) {
  const caseId = caseIdFromInboxSource(item.sourceUrl);
  const when = new Date(item.createdTime).toLocaleString();
  if (!caseId) {
    return (
      <li>
        <strong>{item.subject}</strong>
        <span>{item.type}</span>
        <time dateTime={item.createdTime}>{when}</time>
      </li>
    );
  }
  return (
    <li>
      <button type="button" className="vf-inbox-open" onClick={() => onOpen(caseId)}>
        <strong>{item.subject}</strong>
        <span>{item.type}</span>
        <time dateTime={item.createdTime}>{when}</time>
      </button>
    </li>
  );
}
