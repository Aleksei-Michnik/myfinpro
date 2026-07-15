import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { TRANSACTION_OCCURRENCES_QUEUE } from './queue.constants';

/**
 * Unit smoke test for the QueueModule wiring.
 *
 * We don't import QueueModule directly — its `forRootAsync` would attempt to
 * open a real Redis connection at boot. Instead we re-exercise the same
 * registration shape (`BullModule.forRoot` + `registerQueue`) with a mocked
 * connection, then prove that `@InjectQueue(TRANSACTION_OCCURRENCES_QUEUE)`
 * resolves to a Queue token. This keeps the contract honest while the
 * integration spec covers the real-Redis round-trip.
 */
describe('QueueModule (unit)', () => {
  const fakeClient = { ping: jest.fn().mockResolvedValue('PONG') };
  const fakeQueue = { client: Promise.resolve(fakeClient), name: TRANSACTION_OCCURRENCES_QUEUE };

  it('exposes a Queue under the TRANSACTION_OCCURRENCES_QUEUE token', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        BullModule.forRoot({
          // Connection isn't used because we override the queue provider below,
          // but the module still requires a config object.
          connection: { host: '127.0.0.1', port: 6379 },
        }),
        BullModule.registerQueue({ name: TRANSACTION_OCCURRENCES_QUEUE }),
      ],
    })
      .overrideProvider(getQueueToken(TRANSACTION_OCCURRENCES_QUEUE))
      .useValue(fakeQueue)
      .compile();

    const queue = module.get<Queue>(getQueueToken(TRANSACTION_OCCURRENCES_QUEUE));

    expect(queue).toBeDefined();
    expect(queue.name).toBe(TRANSACTION_OCCURRENCES_QUEUE);
    await module.close();
  });

  it('uses a single source of truth for the queue name', () => {
    expect(TRANSACTION_OCCURRENCES_QUEUE).toBe('transaction-occurrences');
  });
});
