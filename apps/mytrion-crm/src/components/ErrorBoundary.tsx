/**
 * Render-crash boundary. A throw inside a lazy Mytrion module (or a failed chunk load after a
 * deploy) must degrade to a readable message + a recovery action — never a white screen.
 */
import { Component, type ReactNode } from 'react';
import styles from './ErrorBoundary.module.css';

function isChunkLoadError(error: Error): boolean {
  return (
    error.name === 'ChunkLoadError' ||
    /dynamically imported module|Loading chunk|Importing a module script failed/i.test(error.message)
  );
}

interface Props {
  children: ReactNode;
  /** Custom fallback; `retry` re-mounts the children. */
  fallback?: (error: Error, retry: () => void) => ReactNode;
}

interface BoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, BoundaryState> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  private retry = (): void => {
    // A failed chunk usually means a new deploy replaced the hashed assets — reload for real.
    if (this.state.error && isChunkLoadError(this.state.error)) {
      window.location.reload();
      return;
    }
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.retry);
    const chunk = isChunkLoadError(error);
    return (
      <div className={styles.box} role="alert">
        <p className={styles.title}>{chunk ? 'A newer version is available' : 'Something went wrong'}</p>
        <p className={styles.detail}>
          {chunk ? 'The app was updated while this page was open.' : error.message}
        </p>
        <button type="button" className={styles.btn} onClick={this.retry}>
          {chunk ? 'Reload' : 'Try again'}
        </button>
      </div>
    );
  }
}
