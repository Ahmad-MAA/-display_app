import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * A rendering bug must never leave the presenter with a blank panel: show what happened and
 * a way back. The projector keeps running; it's driven by the main process, not this page.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    void window.projectorDesk.reportError(
      `${error.stack ?? error.message}\n${info.componentStack ?? ''}`,
    );
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="m-6 max-w-2xl rounded-lg border border-rose-700 bg-rose-950/60 p-5 text-sm text-rose-100">
        <h1 className="mb-2 text-base font-semibold">The Control Panel hit an error</h1>
        <p className="mb-3">
          The projector is not affected. Reload the panel to continue; the error was written to the
          log.
        </p>
        <pre className="mb-4 max-h-40 overflow-auto rounded bg-black/40 p-2 text-xs whitespace-pre-wrap">
          {this.state.error.message}
        </pre>
        <button
          className="rounded bg-rose-700 px-3 py-1 hover:bg-rose-600"
          onClick={() => {
            window.location.reload();
          }}
        >
          Reload Control Panel
        </button>
      </div>
    );
  }
}
