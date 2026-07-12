import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { buildRedisConnection } from '../config/redis.config';
import {
  PAYMENT_OCCURRENCES_QUEUE,
  PRODUCT_IMAGES_QUEUE,
  RECEIPT_EXTRACTIONS_QUEUE,
} from './queue.constants';

/**
 * Phase 6.17.1 — BullMQ infrastructure module.
 *
 * Wires a single Redis connection used by every BullMQ queue in the API.
 * Marked `@Global()` so feature modules can `@InjectQueue(...)` without
 * re-importing this module.
 *
 * Adding a new queue:
 *  1. Add a constant in [`queue.constants.ts`](apps/api/src/queue/queue.constants.ts:1).
 *  2. Add another `BullModule.registerQueue({ name: ... })` entry below.
 *
 * Graceful shutdown: `@nestjs/bullmq` registers an `OnApplicationShutdown`
 * hook on every queue/worker provider, so calling `app.close()` (or sending
 * SIGTERM with `app.enableShutdownHooks()` enabled in
 * [`main.ts`](apps/api/src/main.ts:1)) closes the underlying ioredis client
 * cleanly. Nothing extra to do here.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        connection: buildRedisConnection(config),
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue({ name: PAYMENT_OCCURRENCES_QUEUE }),
    BullModule.registerQueue({ name: RECEIPT_EXTRACTIONS_QUEUE }),
    BullModule.registerQueue({ name: PRODUCT_IMAGES_QUEUE }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
