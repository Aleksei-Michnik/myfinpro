import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AUTH_ERRORS } from './constants/auth-errors';
import { RegisterDto } from './dto/register.dto';
import { ValidatedUser } from './interfaces/validated-user.interface';
import { OAuthService } from './services/oauth.service';
import { PasswordService } from './services/password.service';
import { RefreshTokenService } from './services/refresh-token.service';
import { TokenService } from './services/token.service';

export interface GoogleProfile {
  googleId: string;
  email?: string;
  name: string;
  picture?: string;
  emailVerified: boolean;
}

export interface TelegramProfile {
  telegramId: string;
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly oauthService: OAuthService,
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

  async findOrCreateGoogleUser(googleProfile: GoogleProfile): Promise<ValidatedUser> {
    const { googleId, email, name, picture, emailVerified } = googleProfile;

    // 1. Check if this Google account is already linked
    const existingOAuth = await this.oauthService.findByProvider('google', googleId);
    if (existingOAuth) {
      const user = await this.prisma.user.findUnique({
        where: { id: existingOAuth.userId },
      });
      if (!user) {
        throw new UnauthorizedException({
          message: 'User not found',
          errorCode: AUTH_ERRORS.USER_NOT_FOUND,
        });
      }
      if (!user.isActive) {
        throw new UnauthorizedException({
          message: 'Account is inactive',
          errorCode: AUTH_ERRORS.OAUTH_ACCOUNT_INACTIVE,
        });
      }
      const { passwordHash, ...result } = user;
      return result;
    }

    // 2. If email is verified, check if a user with this email already exists
    if (email && emailVerified) {
      const existingUser = await this.prisma.user.findUnique({
        where: { email },
      });

      if (existingUser) {
        if (!existingUser.isActive) {
          throw new UnauthorizedException({
            message: 'Account is inactive',
            errorCode: AUTH_ERRORS.OAUTH_ACCOUNT_INACTIVE,
          });
        }

        // Link Google to the existing user
        await this.oauthService.linkToUser('google', googleId, existingUser.id, {
          email,
          name,
          avatarUrl: picture,
        });

        this.logger.log(
          `Google account linked to existing user: ${existingUser.email} (${existingUser.id})`,
        );

        const { passwordHash, ...result } = existingUser;
        return result;
      }
    }

    // 3. No user found — create new User + OAuthProvider in a transaction
    if (!email || !emailVerified) {
      throw new UnauthorizedException({
        message: 'Google account email is not verified',
        errorCode: AUTH_ERRORS.OAUTH_EMAIL_NOT_VERIFIED,
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email,
          passwordHash: null,
          name: name || email.split('@')[0],
          emailVerified: true,
        },
      });

      await tx.oAuthProvider.create({
        data: {
          provider: 'google',
          providerId: googleId,
          userId: newUser.id,
          email,
          name,
          avatarUrl: picture,
        },
      });

      return newUser;
    });

    this.logger.log(`New user created via Google OAuth: ${result.email} (${result.id})`);

    // Log audit event
    await this.prisma.auditLog.create({
      data: {
        userId: result.id,
        action: 'USER_REGISTERED_OAUTH',
        entity: 'User',
        entityId: result.id,
        details: { email: result.email, provider: 'google' },
      },
    });

    const { passwordHash, ...userWithoutPassword } = result;
    return userWithoutPassword;
  }

  async findOrCreateTelegramUser(profile: TelegramProfile): Promise<ValidatedUser> {
    const { telegramId, firstName, lastName, username, photoUrl } = profile;

    // 1. Check if this Telegram account is already linked
    const existingOAuth = await this.oauthService.findByProvider('telegram', telegramId);
    if (existingOAuth) {
      const user = await this.prisma.user.findUnique({
        where: { id: existingOAuth.userId },
      });
      if (!user) {
        throw new UnauthorizedException({
          message: 'User not found',
          errorCode: AUTH_ERRORS.USER_NOT_FOUND,
        });
      }
      if (!user.isActive) {
        throw new UnauthorizedException({
          message: 'Account is inactive',
          errorCode: AUTH_ERRORS.OAUTH_ACCOUNT_INACTIVE,
        });
      }
      const { passwordHash, ...result } = user;
      return result;
    }

    // 2. No email matching for Telegram — always create new User + OAuthProvider
    const displayName = lastName ? `${firstName} ${lastName}` : firstName;
    const email = `telegram_${telegramId}@telegram.user`;

    const result = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email,
          passwordHash: null,
          name: displayName,
          emailVerified: false,
        },
      });

      await tx.oAuthProvider.create({
        data: {
          provider: 'telegram',
          providerId: telegramId,
          userId: newUser.id,
          name: displayName,
          avatarUrl: photoUrl,
          metadata: {
            username: username || null,
            firstName,
            lastName: lastName || null,
          },
        },
      });

      return newUser;
    });

    this.logger.log(`New user created via Telegram OAuth: ${result.email} (${result.id})`);

    // Log audit event
    await this.prisma.auditLog.create({
      data: {
        userId: result.id,
        action: 'USER_REGISTERED_OAUTH',
        entity: 'User',
        entityId: result.id,
        details: { email: result.email, provider: 'telegram' },
      },
    });

    const { passwordHash, ...userWithoutPassword } = result;
    return userWithoutPassword;
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
