import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AUTH_ERRORS } from './constants/auth-errors';
import { RegisterDto } from './dto/register.dto';
import { ValidatedUser } from './interfaces/validated-user.interface';
import { PasswordService } from './services/password.service';
import { RefreshTokenService } from './services/refresh-token.service';
import { TokenService } from './services/token.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly refreshTokenService: RefreshTokenService,
  ) {}

  async register(dto: RegisterDto, response: Response, ip?: string, userAgent?: string) {
    // Check if email already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException({
        message: 'An account with this email already exists',
        errorCode: AUTH_ERRORS.EMAIL_ALREADY_EXISTS,
      });
    }

    // Hash password
    const passwordHash = await this.passwordService.hash(dto.password);

    // Create user
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        name: dto.name,
        defaultCurrency: dto.defaultCurrency || 'USD',
        locale: dto.locale || 'en',
      },
    });

    this.logger.log(`User registered: ${user.email} (${user.id})`);

    // Log audit event
    await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'USER_REGISTERED',
        entity: 'User',
        entityId: user.id,
        details: { email: user.email },
      },
    });

    // Generate tokens
    const accessToken = this.tokenService.generateAccessToken(user);
    const refreshToken = this.tokenService.generateRefreshToken();

    // Store hashed refresh token in DB
    await this.prisma.refreshToken.create({
      data: {
        tokenHash: this.tokenService.hashToken(refreshToken),
        userId: user.id,
        expiresAt: this.tokenService.getRefreshExpirationDate(),
        ipAddress: ip,
        userAgent: userAgent,
      },
    });

    // Set refresh token as httpOnly cookie
    this.tokenService.setRefreshTokenCookie(response, refreshToken);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        defaultCurrency: user.defaultCurrency,
        locale: user.locale,
      },
      accessToken,
    };
  }

  async validateUser(email: string, password: string): Promise<ValidatedUser | null> {
    const normalizedEmail = email.toLowerCase().trim();

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    // Generic error — don't reveal whether email exists or password is wrong
    if (!user || !user.passwordHash) {
      return null;
    }

    // Check if account is active
    if (!user.isActive) {
      return null;
    }

    const isPasswordValid = await this.passwordService.verify(user.passwordHash, password);
    if (!isPasswordValid) {
      // Log failed login attempt
      await this.prisma.auditLog.create({
        data: {
          userId: user.id,
          action: 'LOGIN_FAILED',
          entity: 'User',
          entityId: user.id,
          details: { reason: 'invalid_password' },
        },
      });
      return null;
    }

    // Return user without password hash
    const { passwordHash, ...result } = user;
    return result;
  }

  async login(user: ValidatedUser, response: Response, ip?: string, userAgent?: string) {
    // Update last login time
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Log login event
    await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'USER_LOGIN',
        entity: 'User',
        entityId: user.id,
      },
    });

    this.logger.log(`User logged in: ${user.email} (${user.id})`);

    // Generate tokens
    const accessToken = this.tokenService.generateAccessToken(user);
    const refreshToken = this.tokenService.generateRefreshToken();

    // Store hashed refresh token in DB
    await this.prisma.refreshToken.create({
      data: {
        tokenHash: this.tokenService.hashToken(refreshToken),
        userId: user.id,
        expiresAt: this.tokenService.getRefreshExpirationDate(),
        ipAddress: ip,
        userAgent: userAgent,
      },
    });

    // Set refresh token as httpOnly cookie
    this.tokenService.setRefreshTokenCookie(response, refreshToken);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        defaultCurrency: user.defaultCurrency,
        locale: user.locale,
      },
      accessToken,
    };
  }

  async refreshTokens(refreshToken: string, response: Response, ip?: string, userAgent?: string) {
    // Rotate: validate old token, revoke it, create new one
    const { userId, newRefreshToken } = await this.refreshTokenService.rotateRefreshToken(
      refreshToken,
      ip,
      userAgent,
    );

    // Fetch user for access token generation
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException({
        message: 'User not found or inactive',
        errorCode: AUTH_ERRORS.REFRESH_FAILED,
      });
    }

    // Generate new access token
    const accessToken = this.tokenService.generateAccessToken(user);

    // Set new refresh token cookie
    this.tokenService.setRefreshTokenCookie(response, newRefreshToken);

    this.logger.log(`Tokens refreshed for user: ${user.email} (${user.id})`);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        defaultCurrency: user.defaultCurrency,
        locale: user.locale,
      },
      accessToken,
    };
  }

  async logout(refreshToken: string, response: Response, userId?: string) {
    // Revoke the refresh token in DB
    const tokenHash = this.tokenService.hashToken(refreshToken);
    await this.refreshTokenService.revokeToken(tokenHash);

    // Clear the refresh token cookie
    this.tokenService.clearRefreshTokenCookie(response);

    // Log audit event
    await this.prisma.auditLog.create({
      data: {
        userId: userId || null,
        action: 'USER_LOGOUT',
        entity: 'User',
        entityId: userId || null,
      },
    });

    this.logger.log(`User logged out${userId ? `: ${userId}` : ''}`);

    return { message: 'Logged out successfully' };
  }

  async getUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        defaultCurrency: true,
        locale: true,
        timezone: true,
      },
    });
    if (!user) {
      throw new UnauthorizedException({
        message: 'User not found',
        errorCode: AUTH_ERRORS.USER_NOT_FOUND,
      });
    }
    return user;
  }
}
