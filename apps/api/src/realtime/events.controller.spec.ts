import type { Request } from 'express';
import { firstValueFrom, take, toArray } from 'rxjs';
import { EventBus } from './event-bus.service';
import { EventsController } from './events.controller';
import type { RealtimeEvent } from './events.types';

const fakeRequest = (): Request => {
  const handlers: Record<string, Array<() => void>> = {};
  return {
    on: (evt: string, fn: () => void) => {
      (handlers[evt] ||= []).push(fn);
    },
    emit: (evt: string) => {
      (handlers[evt] || []).forEach((fn) => fn());
    },
  } as unknown as Request;
};

describe('EventsController', () => {
  let bus: EventBus;
  let controller: EventsController;

  beforeEach(() => {
    bus = new EventBus();
    controller = new EventsController(bus);
  });

  afterEach(() => {
    controller.onApplicationShutdown();
    bus.onApplicationShutdown();
  });

  it('streams a published event for the authenticated user with an SSE id', async () => {
    const req = fakeRequest();
    const obs = controller.stream({ sub: 'u1', email: 'a', name: 'A' }, req);
    const collected = firstValueFrom(obs.pipe(take(1)));

    const event: RealtimeEvent = { type: 'payment.deleted', userIds: ['u1'], paymentId: 'p1' };
    // Allow the inner subscribe to wire up before publishing.
    await new Promise((r) => setTimeout(r, 0));
    bus.publish(event);

    const msg = await collected;
    expect(msg.id).toBeDefined();
    expect(msg.data).toMatchObject({ type: 'payment.deleted', paymentId: 'p1' });
  });

  it('does not stream events targeted at other users', async () => {
    const req = fakeRequest();
    const obs = controller.stream({ sub: 'u1', email: 'a', name: 'A' }, req);
    const collected = firstValueFrom(obs.pipe(take(1)));

    await new Promise((r) => setTimeout(r, 0));
    bus.publish({ type: 'payment.deleted', userIds: ['u2'], paymentId: 'p1' });
    bus.publish({ type: 'payment.deleted', userIds: ['u1'], paymentId: 'p2' });

    const msg = await collected;
    expect((msg.data as { paymentId: string }).paymentId).toBe('p2');
  });

  it('terminates the stream when the client disconnects', async () => {
    const req = fakeRequest();
    const obs = controller.stream({ sub: 'u1', email: 'a', name: 'A' }, req);
    const collected = firstValueFrom(obs.pipe(toArray()));

    await new Promise((r) => setTimeout(r, 0));
    (req as unknown as { emit: (e: string) => void }).emit('close');

    const all = await collected;
    expect(all).toEqual([]);
  });

  it('terminates the stream on application shutdown', async () => {
    const req = fakeRequest();
    const obs = controller.stream({ sub: 'u1', email: 'a', name: 'A' }, req);
    const collected = firstValueFrom(obs.pipe(toArray()));

    await new Promise((r) => setTimeout(r, 0));
    controller.onApplicationShutdown();

    const all = await collected;
    expect(all).toEqual([]);
  });
});
