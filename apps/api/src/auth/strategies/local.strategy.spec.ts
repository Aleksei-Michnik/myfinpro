import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from '../auth.service';
import { LocalStrategy } from './local.strategy';

describe('LocalStrategy', () => {
  let strategy: LocalStrategy;

  const mockAuthService = {
    validateUser: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocalStrategy,
        { provide: AuthService, useValue: mockAuthService },
      ],
    }).compile();

    strategy = module.get<LocalStrategy>(LocalStrategy);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(strategy).toBeDefined();
  });

  describe('validate()', () => {
    const mockUser = {
      id: 'test-uuid-1234',
      email: 'test@example.com',
      name: 'Test User',
      defaultCurrency: 'USD',
      locale: 'en',
    };

    it('should return user for valid credentials', async () => {
      mockAuthService.validateUser.mockResolvedValue(mockUser);

      const result = await strategy.validate('test@example.com', 'SecurePass123');

      expect(result).toEqual(mockUser);
      expect(mockAuthService.validateUser).toHaveBeenCalledWith(
        'test@example.com',
        'SecurePass123',
      );
    });

    it('should throw UnauthorizedException for invalid credentials', async () => {
      mockAuthService.validateUser.mockResolvedValue(null);

      await expect(
        strategy.validate('test@example.com', 'WrongPass'),
      ).rejects.toThrow(UnauthorizedException);

      await expect(
        strategy.validate('test@example.com', 'WrongPass'),
      ).rejects.toThrow('Invalid email or password');
    });
  });
});
