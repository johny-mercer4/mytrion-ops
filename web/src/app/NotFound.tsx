import { Link } from 'react-router-dom';
import { StatusMessage } from '../components/StatusMessage';

/** 404 — unknown route or unknown Mytrion slug. */
export function NotFound() {
  return (
    <div style={{ padding: 32, maxWidth: 560, margin: '0 auto' }}>
      <StatusMessage tone="error">That page doesn’t exist.</StatusMessage>
      <p style={{ marginTop: 16 }}>
        <Link to="/">← Back to your Mytrions</Link>
      </p>
    </div>
  );
}
