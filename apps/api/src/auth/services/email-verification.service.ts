import * as crypto from 'crypto';
import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AUTH_ERRORS } from '../constants/auth-errors';

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  /** Token validity: 24 hours */
  private readonly TOKEN_EXPIRY_HOURS = 24;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  /**
   * Generate a verification token, store its SHA-256 hash in DB,
   * invalidate any previous unused tokens for this user,
   * and send the raw token via email.
   */
  async createAndSendVerification(
    userId: string,
    email: string,
    name: string,
    locale: string,
  ): Promise<void> {
    // Generate a UUID token
    const rawToken = this.generateToken();
    const tokenHash = this.hashToken(rawToken);

    // Invalidate (delete) any previous unused verification tokens for this user
    await this.prisma.emailVerificationToken.deleteMany({
      where: {
        userId,
        usedAt: null,
      },
    });

    // Store the hashed token
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + this.TOKEN_EXPIRY_HOURS);

    await this.prisma.emailVerificationToken.create({
      data: {
        tokenHash,
        userId,
        expiresAt,
      },
    });

    this.logger.log(`Verification token created for user ${userId}`);

    // Send the raw token via email
    await this.mailService.sendVerificationEmail(email, name, rawToken, locale);
  }

  /**
   * Verify an email verification token:
   * - Hash the incoming raw token
   * - Look up in DB
   * - Check not expired, not already used
   * - Mark as used, set user.emailVerified = true
   */
  async verifyEmail(rawToken: string): Promise<{ userId: string }> {
    const tokenHash = this.hashToken(rawToken);

    const tokenRecord = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
    });

    if (!tokenRecord) {
      throw new UnauthorizedException({
        message: 'Invalid verification token',
        errorCode: AUTH_ERRORS.VERIFICATION_TOKEN_INVALID,
      });
    }

    if (tokenRecord.usedAt) {
      throw new BadRequestException({
        message: 'Verification token has already been used',
        errorCode: AUTH_ERRORS.VERIFICATION_TOKEN_USED,
      });
    }

    if (tokenRecord.expiresAt < new Date()) {
      throw new BadRequestException({
        message: 'Verification token has expired',
        errorCode: AUTH_ERRORS.VERIFICATION_TOKEN_EXPIRED,
      });
    }

    // Mark token as used and set user's emailVerified = true
    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.update({
        where: { id: tokenRecord.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: tokenRecord.userId },
        data: { emailVerified: true },
      }),
    ]);

    this.logger.log(`Email verified for user ${tokenRecord.userId}`);

    return { userId: tokenRecord.userId };
  }

  /**
   * Resend a verification email for the given user.
   * Throws if user is already verified.
   */
  async resendVerification(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, locale: true, emailVerified: true },
    });

    if (!user) {
      throw new UnauthorizedException({
        message: 'User not found',
        errorCode: AUTH_ERRORS.USER_NOT_FOUND,
      });
    }

    if (user.emailVerified) {
      throw new BadRequestException({
        message: 'Email is already verified',
        errorCode: AUTH_ERRORS.EMAIL_ALREADY_VERIFIED,
      });
    }

    await this.createAndSendVerification(user.id, user.email, user.name, user.locale);
  }

  /**
   * SHA-256 hash of a raw token string.
   */
  hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Generate a new random UUID token.
   */
  private generateToken(): string {
    return crypto.randomUUID();
  }
}
