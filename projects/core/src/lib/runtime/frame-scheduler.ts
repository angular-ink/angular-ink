const DEFAULT_MAX_FPS = 30;

/**
 * Throttles frames: the first request draws at once, and requests inside the interval become one
 * frame at its end. A `maxFps` of zero or less uses the default, so it can never mean "no limit".
 */
export class FrameScheduler {
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private held = false;

  constructor(
    private readonly draw: () => void,
    maxFps: number = DEFAULT_MAX_FPS,
  ) {
    const fps = maxFps > 0 ? maxFps : DEFAULT_MAX_FPS;
    this.intervalMs = Math.max(1, Math.ceil(1000 / fps));
  }

  get pending(): boolean {
    return this.held;
  }

  request(): void {
    if (this.timer !== null) {
      this.held = true;
      return;
    }
    this.startInterval();
    this.draw();
  }

  flush(): void {
    if (!this.held) return;
    this.held = false;
    this.draw();
  }

  cancel(): void {
    this.held = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private startInterval(): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.held) return;
      this.held = false;
      this.startInterval();
      this.draw();
    }, this.intervalMs);
  }
}
