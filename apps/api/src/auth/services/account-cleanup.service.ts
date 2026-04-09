import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

const GRACE_PERIOD_DAYS = 30;

@Injectable()
export class AccountCleanupService {
  private readonly logger = new Logger(AccountCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs daily at 3:00 AM to permanently delete accounts
   * whose soft-deletion grace period has expired.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleExpiredAccounts(): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - GRACE_PERIOD_DAYS);

    this.logger.log(`Running account cleanup. Cutoff date: ${cutoffDate.toISOString()}`);

    try {
      // Find expired accounts first for logging
      const expiredAccounts = await this.prisma.user.findMany({
        where: {
          deletedAt: {
            not: null,
            lte: cutoffDate,
          },
        },
        select: { id: true, email: true, deletedAt: true },
      });

      if (expiredAccounts.length === 0) {
        this.logger.log('No expired accounts found for cleanup.');
        return;
      }

      this.logger.log(`Found ${expiredAccounts.length} expired account(s) to delete.`);

      // Hard delete in a transaction
      const userIds = expiredAccounts.map((u) => u.id);

      const result = await this.prisma.$transaction(async (tx) => {
        // Delete related records first (referential integrity)
        // Delete OAuthProvider records
        await tx.oAuthProvider.deleteMany({
          where: { userId: { in: userIds } },
        });

        // Delete RefreshToken records
        await tx.refreshToken.deleteMany({
          where: { userId: { in: userIds } },
        });

        // Delete EmailVerificationToken records
        await tx.emailVerificationToken.deleteMany({
          where: { userId: { in: userIds } },
        });

        // Delete PasswordResetToken records
        await tx.passwordResetToken.deleteMany({
          where: { userId: { in: userIds } },
        });

        // Finally delete the user records
        const deleted = await tx.user.deleteMany({
          where: { id: { in: userIds } },
        });

        return deleted;
      });

      this.logger.log(
        `Successfully deleted ${result.count} expired account(s). ` +
          `IDs: ${expiredAccounts.map((u) => u.id).join(', ')}`,
      );
    } catch (error) {
      this.logger.error(
        'Failed to clean up expired accounts',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
