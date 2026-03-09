import { Test, TestingModule } from '@nestjs/testing';
import { AppService } from './app.service';

describe('AppService', () => {
  let service: AppService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AppService],
    }).compile();

    service = module.get<AppService>(AppService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getRoot', () => {
    it('should return object with name, version, and status fields', () => {
      const result = service.getRoot();

      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('version');
      expect(result).toHaveProperty('status');
    });

    it('should have status always set to "ok"', () => {
      const result = service.getRoot();

      expect(result.status).toBe('ok');
    });

    it('should return the expected shape exactly', () => {
      const result = service.getRoot();

      expect(result).toEqual({
        name: 'MyFinPro API',
        version: '0.1.0',
        status: 'ok',
      });
    });
  });
});
