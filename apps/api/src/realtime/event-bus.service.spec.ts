import { firstValueFrom, take, toArray } from 'rxjs';
import { EventBus } from './event-bus.service';
import type { RealtimeEvent } from './events.types';

const ev = (userIds: string[], paymentId = 'p1'): RealtimeEvent => ({
  type: 'payment.deleted',
  userIds,
  paymentId,
});

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  afterEach(() => bus.onApplicationShutdown());

  it('delivers events to a subscribed user', async () => {
    const collected = firstValueFrom(bus.subscribeForUser('u1').pipe(take(1)));
    bus.publish(ev(['u1']));
    const received = await collected;
    expect(received).toMatchObject({ type: 'payment.deleted', paymentId: 'p1' });
  });

  it('filters out events not addressed to the user (multicast)', async () => {
    const u1Events = firstValueFrom(bus.subscribeForUser('u1').pipe(take(2), toArray()));
    const u2Events = firstValueFrom(bus.subscribeForUser('u2').pipe(take(1), toArray()));

    bus.publish(ev(['u1'], 'p1'));
    bus.publish(ev(['u2'], 'p2'));
    bus.publish(ev(['u1', 'u2'], 'p3'));

    const u1 = await u1Events;
    const u2 = await u2Events;
    expect(u1.map((e) => (e as { paymentId: string }).paymentId)).toEqual(['p1', 'p3']);
    expect(u2).toHaveLength(1);
    expect((u2[0] as { paymentId: string }).paymentId).toBe('p2');
  });

  it('drops events with empty userIds', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const received: RealtimeEvent[] = [];
    const sub = bus.subscribeForUser('u1').subscribe((e) => received.push(e));
    bus.publish({ ...ev(['u1']), userIds: [] });
    sub.unsubscribe();
    expect(received).toHaveLength(0);
    warn.mockRestore();
  });

  it('completes streams on shutdown', () => {
    let completed = false;
    const sub = bus.subscribeForUser('u1').subscribe({ complete: () => (completed = true) });
    bus.onApplicationShutdown();
    sub.unsubscribe();
    expect(completed).toBe(true);
  });

  it('cleans up after a subscriber unsubscribes', () => {
    const received: RealtimeEvent[] = [];
    const sub = bus.subscribeForUser('u1').subscribe((e) => received.push(e));
    bus.publish(ev(['u1']));
    sub.unsubscribe();
    bus.publish(ev(['u1']));
    expect(received).toHaveLength(1);
  });
});
