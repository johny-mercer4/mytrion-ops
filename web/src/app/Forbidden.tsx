import { Link } from 'react-router-dom';
import { StatusMessage } from '../components/StatusMessage';

/** 403 — the user is known but not allowed into the requested Mytrion. */
export function Forbidden({ reason }: { reason: string }) {
  return (
    <div style={{ padding: 32, maxWidth: 560, margin: '0 auto' }}>
      <StatusMessage tone="error">{reason}</StatusMessage>
      <p style={{ marginTop: 16 }}>
        <Link to="/">← Back to your Mytrions</Link>
      </p>
    </div>
  );
}
