// Imported first by main.ts: forwards uncaught errors to the main-process log. The Output has
// no UI of its own for errors (the audience must never see one).
const api = window.projectorOutput;

window.addEventListener('error', (e) => {
  api.reportError(e.error instanceof Error ? (e.error.stack ?? e.message) : e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  const r: unknown = e.reason;
  api.reportError(
    `Unhandled promise rejection: ${r instanceof Error ? (r.stack ?? r.message) : String(r)}`,
  );
});
