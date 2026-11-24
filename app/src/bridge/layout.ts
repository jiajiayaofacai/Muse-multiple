import type { ContentBounds } from '../../contracts/workspace';

type Geometry = Omit<ContentBounds, 'layoutSeq'>;

export function slotGeometry(rect: Pick<DOMRect, 'x' | 'y' | 'width' | 'height'>, visible: boolean): Geometry {
  if (!visible || rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0, width: 0, height: 0, visible: false };
  // Keep native bounds inside the CSS rectangle despite fractional DPI rounding.
  const x = Math.ceil(rect.x);
  const y = Math.ceil(rect.y);
  return { x, y, width: Math.max(0, Math.floor(rect.x + rect.width) - x), height: Math.max(0, Math.floor(rect.y + rect.height) - y), visible: true };
}

export class NativeLayout {
  private visible = false;
  private initialized = false;
  private seq = 0;
  private request = 0;
  private key = '';
  private frame = 0;
  private pending: Promise<void> = Promise.resolve();
  private wakeRetry: (() => void) | undefined;
  private observer: ResizeObserver;
  private disposed = false;

  constructor(
    private slot: HTMLElement,
    private send: (bounds: ContentBounds) => Promise<void>,
    private onError: (error: unknown) => void,
    options: { initialSequence?: number } = {},
  ) {
    // Production waits for workspace_layout_begin; tests can explicitly start at zero.
    if (options.initialSequence !== undefined) this.initialize(options.initialSequence);
    this.observer = new ResizeObserver(this.schedule);
    this.observer.observe(slot);
    window.addEventListener('resize', this.schedule);
  }

  initialize(baseline: number): void {
    if (this.initialized || this.disposed || !Number.isSafeInteger(baseline) || baseline < 0 || baseline >= Number.MAX_SAFE_INTEGER) {
      throw new Error('布局握手序号无效，或布局已经初始化。');
    }
    this.seq = baseline;
    this.visible = false;
    this.initialized = true;
  }

  schedule = (): void => {
    if (!this.initialized || this.disposed || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      void this.flush().catch(this.onError);
    });
  };

  setVisible(visible: boolean): Promise<void> {
    this.visible = visible;
    return this.flush();
  }

  private flush(): Promise<void> {
    if (!this.initialized || this.disposed) return Promise.resolve();
    const geometry = slotGeometry(this.slot.getBoundingClientRect(), this.visible);
    const key = JSON.stringify(geometry);
    if (key === this.key) return this.pending;
    this.key = key;
    const request = ++this.request;
    // New bounds interrupt the old retry delay. Serialization still waits for an in-flight IPC.
    this.wakeRetry?.();
    this.pending = this.pending.catch(() => undefined).then(() => this.sendLatest(geometry, request));
    return this.pending;
  }

  private async sendLatest(geometry: Geometry, request: number): Promise<void> {
    for (let retry = 0; !this.disposed && request === this.request; retry++) {
      try {
        await this.send({ ...geometry, layoutSeq: ++this.seq });
        return;
      } catch (error) {
        if (this.disposed || request !== this.request) return;
        const busy = !!error && typeof error === 'object' && 'code' in error && error.code === 'workspace_busy';
        if (!!error && typeof error === 'object' && 'code' in error && error.code === 'invalid_layout') this.key = '';
        if (!busy || retry === 3) {
          // Non-transient failures stay cached unless native bounds may need a later refresh.
          // Exhausted busy batches stop here, but a later same-geometry call may recover.
          if (busy) this.key = '';
          throw error;
        }
        await new Promise<void>(resolve => {
          const done = () => {
            clearTimeout(timer);
            this.wakeRetry = undefined;
            resolve();
          };
          const timer = setTimeout(done, 50);
          this.wakeRetry = done;
        });
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.wakeRetry?.();
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    window.removeEventListener('resize', this.schedule);
  }
}
