import { describe, expect, it } from 'vitest';
import { describeCaptureError } from './projection';

describe('describeCaptureError', () => {
  it('explains a denied capture permission with where to fix it', () => {
    expect(describeCaptureError('NotAllowedError', 'Permission denied')).toMatch(
      /permission denied.*Screen capture/i,
    );
  });
  it('tells the presenter to restore a vanished/minimized source', () => {
    expect(describeCaptureError('NotFoundError', null)).toMatch(/closed or minimized/);
    expect(describeCaptureError('AbortError', null)).toMatch(/closed or minimized/);
  });
  it('falls back to the raw error', () => {
    expect(describeCaptureError('WeirdError', 'boom')).toBe('Capture failed (WeirdError): boom');
    expect(describeCaptureError(null, null)).toBe('Capture failed: unknown error');
  });
});
