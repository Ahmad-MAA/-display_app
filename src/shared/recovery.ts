/**
 * Limits automatic recovery (e.g. reloading a crashed renderer) so a page that crashes on
 * load can't put the app into a reload loop: at most `max` attempts per `windowMs`.
 */
export class RestartBudget {
  private attempts: number[] = [];

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Records an attempt and returns whether it is allowed. */
  tryConsume(now: number): boolean {
    this.attempts = this.attempts.filter((t) => now - t < this.windowMs);
    if (this.attempts.length >= this.max) return false;
    this.attempts.push(now);
    return true;
  }
}

/** One line for the log / banner from anything thrown. */
export function describeError(err: unknown): string {
  if (err instanceof Error) return err.stack ?? `${err.name}: ${err.message}`;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
