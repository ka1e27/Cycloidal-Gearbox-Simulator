import { Component, type ErrorInfo, type ReactNode } from 'react';
import { clearSavedSession } from '../session';

/** Last line of defence: a rendering bug shows a friendly card instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('UI error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card" style={{ maxWidth: 560, margin: '48px auto' }} role="alert">
        <h2 className="card-title">Something went wrong drawing this screen</h2>
        <p className="muted" style={{ margin: '8px 0 16px' }}>
          Your inputs are not lost unless you clear them. Try again; if it keeps happening, clear the saved session and reload.
        </p>
        <p className="small muted" style={{ marginBottom: 16, wordBreak: 'break-word' }}>{this.state.error.message}</p>
        <div className="dialog-actions" style={{ justifyContent: 'flex-start' }}>
          <button type="button" className="btn btn-secondary btn-md" onClick={() => this.setState({ error: null })}>Try again</button>
          <button
            type="button"
            className="btn btn-danger btn-md"
            onClick={() => { clearSavedSession(); window.location.reload(); }}
          >
            Clear saved session and reload
          </button>
        </div>
      </div>
    );
  }
}
