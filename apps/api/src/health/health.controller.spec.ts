import { DiskHealthIndicator, TerminusModule } from '@nestjs/terminus';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../prisma/prisma.service';

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
      memory: { status: 'up', heapUsedMB: 50, heapTotalMB: 200, rssMB: 100, usagePercent: '25%' },
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
      providers: [
        DatabaseHealthIndicator,
        RedisHealthIndicator,
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
            $queryRawUnsafe: jest.fn().mockResolvedValue([{ 1: 1 }]),
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
  });

  describe('checkDetails', () => {
    it('should return detailed health check result', async () => {
      const result = await controller.checkDetails();
      expect(result).toHaveProperty('status', 'ok');
      expect(result.info).toHaveProperty('database');
      expect(result.info).toHaveProperty('memory');
      expect(result.info).toHaveProperty('redis');
    });
  });
});
