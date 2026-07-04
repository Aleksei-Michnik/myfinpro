import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { buildRedisConnection } from '../../src/config/redis.config';
import { PAYMENT_OCCURRENCES_QUEUE } from '../../src/queue/queue.constants';

/**
 * Integration test for the BullMQ queue infrastructure.
 *
 * Spins up a real Redis 7-alpine container via testcontainers, boots a Nest
 * test module with BullModule wired the same way the production
 * [`QueueModule`](apps/api/src/queue/queue.module.ts:1) does, and proves that:
 *  1. The queue can connect (PING).
 *  2. A job can be enqueued and read back from Redis.
 *
 * No processor / worker logic — that lands in iteration 6.17.3.
 */
describe('Queue infrastructure (integration)', () => {
  let redis: StartedTestContainer;
  let module: TestingModule;
  let queue: Queue;

  beforeAll(async () => {
    redis = await new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withCommand(['redis-server', '--appendonly', 'no'])
      .start();

    const host = redis.getHost();
    const port = redis.getMappedPort(6379);

    process.env.REDIS_HOST = host;
    process.env.REDIS_PORT = String(port);
    process.env.REDIS_PASSWORD = '';
    process.env.REDIS_TLS = 'false';

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
        BullModule.forRootAsync({
          imports: [ConfigModule],
          useFactory: (config: ConfigService) => ({
            connection: buildRedisConnection(config),
          }),
          inject: [ConfigService],
        }),
        BullModule.registerQueue({ name: PAYMENT_OCCURRENCES_QUEUE }),
      ],
    }).compile();

    queue = module.get<Queue>(getQueueToken(PAYMENT_OCCURRENCES_QUEUE));
  }, 60_000);

  afterAll(async () => {
    if (queue) {
      await queue.close();
    }
    if (module) {
      await module.close();
    }
    if (redis) {
      await redis.stop();
    }
  }, 30_000);

  it('responds to PING through the BullMQ-managed connection', async () => {
    const client = await queue.client;
    const reply = await client.ping();
    expect(reply).toBe('PONG');
  });

  it('enqueues and reads back a no-op job', async () => {
    const job = await queue.add(
      'noop',
      { hello: 'world' },
      { removeOnComplete: true, removeOnFail: true },
    );

    expect(job.id).toBeDefined();

    const fetched = await queue.getJob(job.id!);
    expect(fetched).toBeDefined();
    expect(fetched?.name).toBe('noop');
    expect(fetched?.data).toEqual({ hello: 'world' });

    // Clean up so we don't leave a queued job dangling.
    await fetched?.remove();
  });
});
