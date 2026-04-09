import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AUTH_ERRORS } from '../constants/auth-errors';
import { RefreshTokenService } from './refresh-token.service';

@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);
  private readonly GRACE_PERIOD_DAYS = 30;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly refreshTokenService: RefreshTokenService,
  ) {}

  /**
   * Request account deletion with a 30-day grace period.
   * Sets isActive=false, scheduledDeletionAt, revokes all sessions.
   */
  async requestDeletion(
    userId: string,
    confirmationEmail: string,
  ): Promise<{ scheduledDeletionAt: Date }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException({
        message: 'User not found',
        errorCode: AUTH_ERRORS.USER_NOT_FOUND,
      });
    }

    // Validate confirmation email matches (case-insensitive)
    if (user.email.toLowerCase() !== confirmationEmail.toLowerCase()) {
      throw new BadRequestException({
        message: 'Confirmation email does not match your account email',
        errorCode: AUTH_ERRORS.ACCOUNT_DELETION_CONFIRMATION_MISMATCH,
      });
    }

    // Check if already soft-deleted
    if (!user.isActive) {
      throw new BadRequestException({
        message: 'Account is already scheduled for deletion',
        errorCode: AUTH_ERRORS.ACCOUNT_ALREADY_DELETED,
      });
    }

    const now = new Date();
    const scheduledDeletionAt = new Date(now);
    scheduledDeletionAt.setDate(scheduledDeletionAt.getDate() + this.GRACE_PERIOD_DAYS);

    // Update user: soft-delete
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        isActive: false,
        deletedAt: now,
        scheduledDeletionAt,
      },
    });

    // Revoke ALL refresh tokens
    await this.refreshTokenService.revokeAllUserTokens(userId);

    // Send deletion confirmation email (fire-and-forget)
    const locale = user.locale || 'en';
    try {
      // The cancelToken is just a placeholder for the email link — actual cancellation
      // requires the user to log in (which triggers reactivation) or use cancel-deletion endpoint
      await this.mailService.sendAccountDeletionConfirmation(
        user.email,
        user.name,
        scheduledDeletionAt,
        'login-to-cancel',
        locale,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to send deletion confirmation email for user ${userId}: ${(err as Error).message}`,
      );
    }

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'ACCOUNT_DELETION_REQUESTED',
        entity: 'User',
        entityId: userId,
        details: { scheduledDeletionAt: scheduledDeletionAt.toISOString() },
      },
    });

    this.logger.log(
      `Account deletion requested for user ${userId}, scheduled for ${scheduledDeletionAt.toISOString()}`,
    );

    return { scheduledDeletionAt };
  }

  /**
   * Cancel a pending account deletion (within grace period).
   */
  async cancelDeletion(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException({
        message: 'User not found',
        errorCode: AUTH_ERRORS.USER_NOT_FOUND,
      });
    }

    // Must be soft-deleted to cancel
    if (user.isActive) {
      throw new BadRequestException({
        message: 'Account is not scheduled for deletion',
        errorCode: AUTH_ERRORS.ACCOUNT_NOT_DELETED,
      });
    }

    // Check if grace period has expired
    if (!user.scheduledDeletionAt || user.scheduledDeletionAt <= new Date()) {
      throw new BadRequestException({
        message: 'Deletion grace period has expired',
        errorCode: AUTH_ERRORS.DELETION_GRACE_PERIOD_EXPIRED,
      });
    }

    // Reactivate account
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        isActive: true,
        deletedAt: null,
        scheduledDeletionAt: null,
      },
    });

    // Send cancellation email (fire-and-forget)
    const locale = user.locale || 'en';
    try {
      await this.mailService.sendAccountDeletionCancelled(user.email, user.name, locale);
    } catch (err) {
      this.logger.warn(
        `Failed to send deletion cancellation email for user ${userId}: ${(err as Error).message}`,
      );
    }

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'ACCOUNT_DELETION_CANCELLED',
        entity: 'User',
        entityId: userId,
      },
    });

    this.logger.log(`Account deletion cancelled for user ${userId}`);
  }

  /**
   * Reactivate a soft-deleted user on login (within grace period).
   * Returns true if the user was reactivated, false otherwise.
   */
  async reactivateOnLogin(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        isActive: true,
        scheduledDeletionAt: true,
        email: true,
        name: true,
        locale: true,
      },
    });

    if (!user) {
      return false;
    }

    // Only reactivate if soft-deleted AND within grace period
    if (!user.isActive && user.scheduledDeletionAt && user.scheduledDeletionAt > new Date()) {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          isActive: true,
          deletedAt: null,
          scheduledDeletionAt: null,
        },
      });

      // Audit log
      await this.prisma.auditLog.create({
        data: {
          userId,
          action: 'ACCOUNT_REACTIVATED_VIA_LOGIN',
          entity: 'User',
          entityId: userId,
        },
      });

      // Send cancellation email (fire-and-forget)
      const locale = user.locale || 'en';
      try {
        await this.mailService.sendAccountDeletionCancelled(user.email, user.name, locale);
      } catch (err) {
        this.logger.warn(
          `Failed to send reactivation email for user ${userId}: ${(err as Error).message}`,
        );
      }

      this.logger.log(`Account reactivated via login for user ${userId}`);
      return true;
    }

    return false;
  }
}
