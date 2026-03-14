import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TokenService } from './token.service';

@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
  ) {}

  /**
   * Rotates a refresh token: validates old token, revokes it, creates new one.
   * Implements token reuse detection — if a revoked token is reused, all user tokens are revoked.
   */
  async rotateRefreshToken(
    oldToken: string,
    ip?: string,
    userAgent?: string,
  ): Promise<{ userId: string; newRefreshToken: string }> {
    const oldTokenHash = this.tokenService.hashToken(oldToken);

    // Find the token in DB
    const existingToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: oldTokenHash },
    });

    if (!existingToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // TOKEN REUSE DETECTION: if token was already revoked, this may be a stolen token replay
    if (existingToken.revokedAt) {
      this.logger.warn(
        `Token reuse detected for user ${existingToken.userId}. Revoking all tokens.`,
      );

      // Revoke ALL tokens for this user (security breach response)
      await this.revokeAllUserTokens(existingToken.userId);

      // Log security audit event
      await this.prisma.auditLog.create({
        data: {
          userId: existingToken.userId,
          action: 'TOKEN_REUSE_DETECTED',
          entity: 'RefreshToken',
          entityId: existingToken.id,
          details: {
            revokedTokenId: existingToken.id,
            ipAddress: ip,
            userAgent: userAgent,
          },
        },
      });

      throw new UnauthorizedException('Token reuse detected. All sessions revoked.');
    }

    // Check if token is expired
    if (existingToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token has expired');
    }

    // Generate new refresh token
    const newRefreshToken = this.tokenService.generateRefreshToken();
    const newTokenHash = this.tokenService.hashToken(newRefreshToken);

    // Create new token record in DB first
    const newTokenRecord = await this.prisma.refreshToken.create({
      data: {
        tokenHash: newTokenHash,
        userId: existingToken.userId,
        expiresAt: this.tokenService.getRefreshExpirationDate(),
        ipAddress: ip,
        userAgent: userAgent,
      },
    });

    // Revoke old token, point to new token's ID
    await this.prisma.refreshToken.update({
      where: { id: existingToken.id },
      data: {
        revokedAt: new Date(),
        replacedBy: newTokenRecord.id,
      },
    });

    return {
      userId: existingToken.userId,
      newRefreshToken,
    };
  }

  /**
   * Revoke a single token by its hash.
   */
  async revokeToken(tokenHash: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: {
        tokenHash,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  /**
   * Revoke ALL refresh tokens for a given user (e.g., on token reuse detection or password change).
   */
  async revokeAllUserTokens(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  /**
   * Delete tokens that expired more than 30 days ago.
   * Intended to be called from a future scheduled cron job.
   */
  async cleanupExpiredTokens(): Promise<number> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const result = await this.prisma.refreshToken.deleteMany({
      where: {
        expiresAt: {
          lt: thirtyDaysAgo,
        },
      },
    });

    this.logger.log(`Cleaned up ${result.count} expired refresh tokens`);
    return result.count;
  }
}
