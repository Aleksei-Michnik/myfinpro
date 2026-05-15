import { getQueueToken } from '@nestjs/bullmq';
import { DiskHealthIndicator, TerminusModule } from '@nestjs/terminus';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { PAYMENT_OCCURRENCES_QUEUE } from '../queue/queue.constants';
import { HealthController } from './health.controller';
import { DatabaseHealthIndicator } from './indicators/database.indicator';
import { MemoryHealthIndicator } from './indicators/memory.indicator';
import { RedisHealthIndicator } from './indicators/redis.indicator';

describe('HealthController', () => {
  let controller: HealthController;

  const mockDiskHealthIndicator = {
    checkStorage: jest.fn().mockResolvedValue({
      disk: { status: 'up', used: 50, threshold: 90 },
    }),
  };

  const mockMemoryHealthIndicator = {
    isHealthy: jest.fn().mockResolvedValue({
      memory: { status: 'up', heapUsedMB: 50, heapTotalMB: 200, rssMB: 100, thresholdMB: 512 },
    }),
  };

  // BullMQ Queue mock — the Redis indicator awaits `queue.client` and calls
  // `.ping()` on it. We resolve immediately with a fake ioredis-like client.
  const mockRedisClient = { ping: jest.fn().mockResolvedValue('PONG') };
  const mockQueue = {
    client: Promise.resolve(mockRedisClient),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
      providers: [
        DatabaseHealthIndicator,
        RedisHealthIndicator,
        {
          provide: getQueueToken(PAYMENT_OCCURRENCES_QUEUE),
          useValue: mockQueue,
        },
        {
          provide: MemoryHealthIndicator,
          useValue: mockMemoryHealthIndicator,
        },
        {
          provide: DiskHealthIndicator,
          useValue: mockDiskHealthIndicator,
        },
        {
          provide: PrismaService,
          useValue: {
            healthCheck: {
              findFirst: jest.fn().mockResolvedValue(null),
            },
          },
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('check', () => {
    it('should return health check result with status ok', async () => {
      const result = await controller.check();
      expect(result).toHaveProperty('status', 'ok');
      expect(result).toHaveProperty('info');
      expect(result.info).toHaveProperty('database');
      expect(result.info).toHaveProperty('memory');
    });

    it('should not ping Redis (fast liveness probe)', async () => {
      mockRedisClient.ping.mockClear();
      await controller.check();
      expect(mockRedisClient.ping).not.toHaveBeenCalled();
    });
  });

  describe('checkDetails', () => {
    it('should return detailed health check result with redis up', async () => {
      const result = await controller.checkDetails();
      expect(result).toHaveProperty('status', 'ok');
      expect(result.info).toHaveProperty('database');
      expect(result.info).toHaveProperty('memory');
      expect(result.info).toHaveProperty('redis');
      expect(result.info?.redis).toMatchObject({ status: 'up', reply: 'PONG' });
    });

    it('should ping Redis through the BullMQ queue client', async () => {
      mockRedisClient.ping.mockClear();
      await controller.checkDetails();
      expect(mockRedisClient.ping).toHaveBeenCalledTimes(1);
    });
  });
});
