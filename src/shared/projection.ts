import type { SourceDescriptor } from './outputEngine';

/**
 * Lifecycle of what's on the projector:
 * idle → (restoring →) starting → live → ended | error
 */
export type ProjectionState = 'idle' | 'restoring' | 'starting' | 'live' | 'ended' | 'error';

/** What's actually captured while "Follow full screen" redirects away from the picked window. */
export interface FollowInfo {
  mode: 'window' | 'screen';
  /** Title of the followed full-screen window. */
  title: string;
  /** Screen fallback: label of the screen being captured instead. */
  screenLabel: string | null;
}

export interface ProjectionInfo {
  /** The source the presenter picked (what the UI shows). */
  source: SourceDescriptor | null;
  /** Non-null while capture follows the picked app's separate full-screen window. */
  following: FollowInfo | null;
  state: ProjectionState;
  /** User-facing explanation for 'ended' / 'error', or a hint while live. */
  message: string | null;
  /** Live capture is delivering (near-)black frames: minimized or protected content. */
  blank: boolean;
  width: number | null;
  height: number | null;
  /** Bumps on every new projection so renderers can restart previews. */
  token: number;
}

export const IDLE_PROJECTION: ProjectionInfo = {
  source: null,
  following: null,
  state: 'idle',
  message: null,
  blank: false,
  width: null,
  height: null,
  token: 0,
};

/** Output window → main, about the capture it was asked to start. */
export interface SourceStatus {
  token: number;
  state: 'live' | 'ended' | 'error' | 'idle';
  /** DOMException name for errors (NotAllowedError, NotFoundError, …). */
  errorName: string | null;
  message: string | null;
  width: number | null;
  height: number | null;
  blank: boolean;
}

export interface ProjectResult {
  ok: boolean;
  message: string | null;
}

/** Map a getDisplayMedia failure to a message a presenter can act on. */
export function describeCaptureError(name: string | null, message: string | null): string {
  switch (name) {
    case 'NotAllowedError':
      return 'Capture permission denied. Windows or ProjectorDesk blocked screen capture; check Settings → Privacy & security → Screen capture, then pick the source again.';
    case 'NotFoundError':
    case 'AbortError':
      return 'The source could not be captured. It may have been closed or minimized; restore it and pick it again.';
    case 'NotReadableError':
      return 'Windows refused to capture this source (it may be protected or on a secure desktop).';
    default:
      return `Capture failed${name ? ` (${name})` : ''}: ${message ?? 'unknown error'}`;
  }
}
