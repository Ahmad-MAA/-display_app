import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';
import './index.css';

// Errors outside React rendering (event handlers, promises) go to the main-process log.
window.addEventListener('error', (e) => {
  void window.projectorDesk.reportError(
    e.error instanceof Error ? (e.error.stack ?? e.message) : e.message,
  );
});
window.addEventListener('unhandledrejection', (e) => {
  const r: unknown = e.reason;
  void window.projectorDesk.reportError(
    `Unhandled promise rejection: ${r instanceof Error ? (r.stack ?? r.message) : String(r)}`,
  );
});

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
