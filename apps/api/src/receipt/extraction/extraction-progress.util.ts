import type { ExtractionProgressUpdate } from './extraction-provider.interface';

/**
 * Phase 8.26 — progress-emission helpers for the extraction worker
 * (design §4.2). Pure and DI-free so the throttle/counter behavior is unit
 * testable without BullMQ or the EventBus.
 */

export interface ProgressEmitterOptions {
  /** Minimum gap between published events (default 300 ms). */
  intervalMs?: number;
  /** Per-event cap on `thought` text; the newest tail wins (default 400). */
  thoughtCapChars?: number;
}

export interface ProgressEmitter {
  /** Queue an update; publishes now or on the trailing edge of the window. */
  emit(update: ExtractionProgressUpdate): void;
  /** Stop emitting and drop anything pending — terminal states are final. */
  stop(): void;
}

/**
 * Throttle to at most one published event per interval: the first update in
 * a quiet window goes out immediately (stage flips feel instant), the rest
 * coalesce onto a trailing-edge timer — latest stage/counters win, thought
 * deltas concatenate (capped, newest tail kept).
 */
export function createProgressEmitter(
  publish: (update: ExtractionProgressUpdate) => void,
  options: ProgressEmitterOptions = {},
): ProgressEmitter {
  const intervalMs = options.intervalMs ?? 300;
  const thoughtCapChars = options.thoughtCapChars ?? 400;

  let lastPublishedAt = -Infinity;
  let pending: ExtractionProgressUpdate | null = null;
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  const publishNow = (update: ExtractionProgressUpdate): void => {
    lastPublishedAt = Date.now();
    if (update.thought && update.thought.length > thoughtCapChars) {
      update = { ...update, thought: update.thought.slice(-thoughtCapChars) };
    }
    try {
      publish(update);
    } catch {
      // Progress is advisory — a broken subscriber must never fail extraction.
    }
  };

  const flushPending = (): void => {
    timer = null;
    if (stopped || !pending) return;
    const update = pending;
    pending = null;
    publishNow(update);
  };

  return {
    emit(update: ExtractionProgressUpdate): void {
      if (stopped) return;
      if (pending) {
        // Coalesce: newest stage/counters win, thoughts accumulate.
        const thought =
          pending.thought || update.thought
            ? `${pending.thought ?? ''}${update.thought ?? ''}`
            : undefined;
        pending = { ...pending, ...update, ...(thought !== undefined ? { thought } : {}) };
      } else if (Date.now() - lastPublishedAt >= intervalMs) {
        publishNow(update);
        return;
      } else {
        pending = update;
      }
      timer ??= setTimeout(flushPending, Math.max(0, lastPublishedAt + intervalMs - Date.now()));
      // Worker process must not be held open by a pending progress tick.
      timer.unref?.();
    },
    stop(): void {
      stopped = true;
      pending = null;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

const RAW_NAME_TOKEN = '"rawName"';

/**
 * Streaming count of line items in provider output — cheap proxy: one
 * `"rawName"` key per item. Chunk-boundary safe (keeps a token-length tail).
 */
export class RawNameCounter {
  private count = 0;
  private tail = '';

  add(chunk: string): number {
    const haystack = this.tail + chunk;
    let index = 0;
    while ((index = haystack.indexOf(RAW_NAME_TOKEN, index)) !== -1) {
      this.count += 1;
      index += RAW_NAME_TOKEN.length;
    }
    // A full token never fits in the tail alone, so no double counting.
    this.tail = haystack.slice(-(RAW_NAME_TOKEN.length - 1));
    return this.count;
  }

  get current(): number {
    return this.count;
  }
}
