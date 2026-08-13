import { ArrowLeft } from 'lucide-react';
import { AnnouncementsBlock } from './AnnouncementsBlock';

export function AnnouncementsWorkspace({ onBack }: { onBack: () => void }) {
  return (
    <div className="mg-page" style={{ ['--mg-tone' as string]: 'var(--tone-violet)' }}>
      <header className="mg-page-head">
        <div className="mg-page-head-left">
          <button
            type="button"
            className="mg-backbtn"
            onClick={onBack}
            aria-label="Back to Manager workspaces"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <div className="mg-kicker">Manager · Company communications</div>
            <h1 className="mg-page-title">Announcements</h1>
            <p className="mg-page-sub">
              Compose one update, target the right departments and track agent views.
            </p>
          </div>
        </div>
      </header>

      <AnnouncementsBlock />
    </div>
  );
}
