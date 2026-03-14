import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';

describe('AuthController', () => {
  let controller: AuthController;

  const mockAuthService = {
    register: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('register()', () => {
    it('should call AuthService.register() with the DTO', async () => {
      const registerDto: RegisterDto = {
        email: 'test@example.com',
        password: 'SecurePass123',
        name: 'Test User',
      };

      const expectedResult = {
        user: {
          id: 'test-uuid',
          email: 'test@example.com',
          name: 'Test User',
          defaultCurrency: 'USD',
          locale: 'en',
        },
        accessToken: 'placeholder-will-be-jwt-in-iteration-1.5',
      };

      mockAuthService.register.mockResolvedValue(expectedResult);

      const result = await controller.register(registerDto);

      expect(mockAuthService.register).toHaveBeenCalledWith(registerDto);
      expect(result).toEqual(expectedResult);
    });

    it('should return the result from AuthService', async () => {
      const registerDto: RegisterDto = {
        email: 'another@example.com',
        password: 'AnotherPass456',
        name: 'Another User',
        defaultCurrency: 'EUR',
        locale: 'he',
      };

      const expectedResult = {
        user: {
          id: 'another-uuid',
          email: 'another@example.com',
          name: 'Another User',
          defaultCurrency: 'EUR',
          locale: 'he',
        },
        accessToken: 'placeholder-will-be-jwt-in-iteration-1.5',
      };

      mockAuthService.register.mockResolvedValue(expectedResult);

      const result = await controller.register(registerDto);

      expect(result).toEqual(expectedResult);
      expect(result.user.email).toBe('another@example.com');
    });
  });
});
