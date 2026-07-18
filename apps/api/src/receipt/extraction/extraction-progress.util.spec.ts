import { createProgressEmitter, RawNameCounter } from './extraction-progress.util';
import type { ExtractionProgressUpdate } from './extraction-provider.interface';

describe('createProgressEmitter (8.26)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const collect = (options?: Parameters<typeof createProgressEmitter>[1]) => {
    const published: ExtractionProgressUpdate[] = [];
    const emitter = createProgressEmitter((u) => published.push(u), options);
    return { published, emitter };
  };

  it('publishes the first update in a quiet window immediately', () => {
    const { published, emitter } = collect();
    emitter.emit({ stage: 'preparing' });
    expect(published).toEqual([{ stage: 'preparing' }]);
  });

  it('coalesces updates inside the window onto the trailing edge — latest stage wins, thoughts concatenate', () => {
    const { published, emitter } = collect();
    emitter.emit({ stage: 'sending' });
    emitter.emit({ stage: 'thinking', thought: 'Reading the header. ' });
    emitter.emit({ stage: 'thinking', thought: 'Totals reconcile.' });
    emitter.emit({ stage: 'generating', itemsSoFar: 3 });
    expect(published).toHaveLength(1); // only the leading edge so far

    jest.advanceTimersByTime(300);
    expect(published).toHaveLength(2);
    expect(published[1]).toEqual({
      stage: 'generating',
      itemsSoFar: 3,
      thought: 'Reading the header. Totals reconcile.',
    });
  });

  it('caps thought text per event, keeping the newest tail', () => {
    const { published, emitter } = collect({ thoughtCapChars: 10 });
    emitter.emit({ stage: 'thinking', thought: 'aaaaabbbbbccccc' });
    expect(published[0].thought).toBe('bbbbbccccc');
  });

  it('stop() drops the pending update and blocks further emissions', () => {
    const { published, emitter } = collect();
    emitter.emit({ stage: 'preparing' });
    emitter.emit({ stage: 'sending' });
    emitter.stop();
    jest.advanceTimersByTime(1000);
    emitter.emit({ stage: 'generating' });
    expect(published).toEqual([{ stage: 'preparing' }]);
  });

  it('swallows subscriber errors — progress must never fail extraction', () => {
    const emitter = createProgressEmitter(() => {
      throw new Error('bus down');
    });
    expect(() => emitter.emit({ stage: 'preparing' })).not.toThrow();
  });

  it('reopens the window after the trailing flush', () => {
    const { published, emitter } = collect();
    emitter.emit({ stage: 'preparing' });
    emitter.emit({ stage: 'sending' });
    jest.advanceTimersByTime(300); // trailing flush → 'sending'
    jest.advanceTimersByTime(300); // window over — next emit is leading again
    emitter.emit({ stage: 'generating' });
    expect(published.map((u) => u.stage)).toEqual(['preparing', 'sending', 'generating']);
  });
});

describe('RawNameCounter (8.26)', () => {
  it('counts item keys across chunk boundaries without double counting', () => {
    const counter = new RawNameCounter();
    expect(counter.add('{"items":[{"raw')).toBe(0);
    expect(counter.add('Name":"Milk"},{"rawName"')).toBe(2);
    expect(counter.add(':"Bread"}]')).toBe(2);
    expect(counter.current).toBe(2);
  });

  it('ignores lookalike keys — only the exact quoted key counts', () => {
    const counter = new RawNameCounter();
    expect(counter.add('{"rawNames":"x","RAWNAME":"y","rawName":"z"}')).toBe(1);
  });
});
