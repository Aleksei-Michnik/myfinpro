import { Test, TestingModule } from '@nestjs/testing';
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  let service: PasswordService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PasswordService],
    }).compile();

    service = module.get<PasswordService>(PasswordService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('hash()', () => {
    it('should return a string starting with $argon2id$', async () => {
      const hash = await service.hash('TestPassword123');
      expect(hash).toMatch(/^\$argon2id\$/);
    });

    it('should return different hashes for the same password (salt)', async () => {
      const hash1 = await service.hash('TestPassword123');
      const hash2 = await service.hash('TestPassword123');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('verify()', () => {
    it('should return true for correct password', async () => {
      const password = 'SecurePass123';
      const hash = await service.hash(password);
      const result = await service.verify(hash, password);
      expect(result).toBe(true);
    });

    it('should return false for wrong password', async () => {
      const hash = await service.hash('SecurePass123');
      const result = await service.verify(hash, 'WrongPassword456');
      expect(result).toBe(false);
    });

    it('should return false for invalid hash', async () => {
      const result = await service.verify('not-a-valid-hash', 'SomePassword');
      expect(result).toBe(false);
    });
  });
});
