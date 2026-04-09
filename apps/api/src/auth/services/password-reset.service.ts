import * as crypto from 'crypto';
import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AUTH_ERRORS } from '../constants/auth-errors';
import { PasswordService } from './password.service';
import { RefreshTokenService } from './refresh-token.service';

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  /** Token validity: 1 hour */
  private readonly TOKEN_EXPIRY_HOURS = 1;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly passwordService: PasswordService,
    private readonly refreshTokenService: RefreshTokenService,
  ) {}

  /**
   * Initiate a password reset flow.
   * Always returns void — never reveals whether the email exists (prevents user enumeration).
   */
  async forgotPassword(email: string): Promise<void> {
    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();

    // Look up user by email
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        email: true,
        name: true,
        locale: true,
        passwordHash: true,
      },
    });

    // If user doesn't exist OR user has no passwordHash (OAuth-only user): do NOTHING
    if (!user || !user.passwordHash) {
      this.logger.log(`Password reset requested for non-eligible email: ${normalizedEmail}`);
      return;
    }

    // Invalidate any previous unused reset tokens for this user
    await this.prisma.passwordResetToken.deleteMany({
      where: {
        userId: user.id,
        usedAt: null,
      },
    });

    // Generate token, hash it, store it
    const rawToken = this.generateToken();
    const tokenHash = this.hashToken(rawToken);

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + this.TOKEN_EXPIRY_HOURS);

    await this.prisma.passwordResetToken.create({
      data: {
        tokenHash,
        userId: user.id,
        expiresAt,
      },
    });

    this.logger.log(`Password reset token created for user ${user.id}`);

    // Get user's locale (default 'en')
    const locale = user.locale || 'en';

    // Send the reset email with the raw token
    await this.mailService.sendPasswordResetEmail(user.email, user.name, rawToken, locale);
  }

  /**
   * Reset the user's password using a valid token.
   * Hashes the new password, marks the token as used, and revokes all refresh tokens.
   */
  async resetPassword(rawToken: string, newPassword: string): Promise<{ userId: string }> {
    const tokenHash = this.hashToken(rawToken);

    // Look up the token (include user relation for userId)
    const tokenRecord = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!tokenRecord) {
      throw new UnauthorizedException({
        message: 'Invalid password reset token',
        errorCode: AUTH_ERRORS.RESET_TOKEN_INVALID,
      });
    }

    if (tokenRecord.usedAt) {
      throw new BadRequestException({
        message: 'Password reset token has already been used',
        errorCode: AUTH_ERRORS.RESET_TOKEN_USED,
      });
    }

    if (tokenRecord.expiresAt < new Date()) {
      throw new UnauthorizedException({
        message: 'Password reset token has expired',
        errorCode: AUTH_ERRORS.RESET_TOKEN_EXPIRED,
      });
    }

    // Hash the new password
    const passwordHash = await this.passwordService.hash(newPassword);

    // In a transaction: update password, mark token used, revoke all refresh tokens
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: tokenRecord.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: tokenRecord.id },
        data: { usedAt: new Date() },
      }),
    ]);

    // Revoke ALL user's refresh tokens (outside transaction — separate DB operation)
    await this.refreshTokenService.revokeAllUserTokens(tokenRecord.userId);

    // Create audit log
    await this.prisma.auditLog.create({
      data: {
        userId: tokenRecord.userId,
        action: 'PASSWORD_RESET',
        entity: 'User',
        entityId: tokenRecord.userId,
        details: {
          tokenId: tokenRecord.id,
        },
      },
    });

    this.logger.log(`Password reset completed for user ${tokenRecord.userId}`);

    return { userId: tokenRecord.userId };
  }

  /**
   * SHA-256 hash of a raw token string.
   */
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Generate a new random UUID token.
   */
  private generateToken(): string {
    return crypto.randomUUID();
  }
}
