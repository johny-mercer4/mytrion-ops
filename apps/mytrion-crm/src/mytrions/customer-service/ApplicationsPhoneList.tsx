import { PhoneList, PhoneListRow } from '../_shared/phone/PhoneList';
import type { Application } from './data';
import type { SubTab } from './ApplicationsTable';

/**
 * Applications on phone: one title + one meta line, tap opens the record sheet.
 * The desktop table stays — twenty onboarding columns do not belong on a 390px WebView.
 */
export function ApplicationsPhoneList({
  rows,
  subTab,
  onOpen,
}: {
  rows: readonly Application[];
  subTab: SubTab;
  onOpen: (app: Application) => void;
}) {
  return (
    <PhoneList label={subTab === 'clients' ? 'Clients' : 'Applications'}>
      {rows.map((app) => {
        const id = subTab === 'clients' ? app.carrierId || app.appId : app.appId;
        const meta = [id, app.stage, app.agent].filter(Boolean).join(' · ');
        return (
          <PhoneListRow
            key={app.id}
            title={app.company || 'Untitled'}
            meta={meta}
            onClick={() => onOpen(app)}
          />
        );
      })}
    </PhoneList>
  );
}
