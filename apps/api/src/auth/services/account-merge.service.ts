import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AUTH_ERRORS } from '../constants/auth-errors';

/**
 * Merges one user account into another.
 *
 * Scenario: a person registers with Google (or email), later signs in via
 * Telegram — the Telegram flow auto-creates a second, separate account.
 * When they later connect the other provider from Settings, both accounts
 * are proven to belong to the same person (they hold an authenticated
 * session for one and just completed the OAuth/HMAC round-trip for the
 * other), so we merge instead of rejecting with a conflict.
 *
 * Everything owned by the source account moves to the target account:
 * OAuth providers, group memberships, transactions and their satellites,
 * categories, receipts. Where the target lacks real credentials, they are
 * adopted from the source (real email, password hash). The source user row
 * is then deleted — refresh/verification/reset tokens cascade away, and
 * audit log rows keep their original userId string for history.
 */
@Injectable()
export class AccountMergeService {
  private readonly logger = new Logger(AccountMergeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Synthetic address given to Telegram-only accounts (no real email). */
  static isPlaceholderEmail(email: string): boolean {
    return email.endsWith('@telegram.user');
  }

  async mergeUsers(targetUserId: string, sourceUserId: string): Promise<void> {
    if (targetUserId === sourceUserId) return;

    await this.prisma.$transaction(async (tx) => {
      const [target, source] = await Promise.all([
        tx.user.findUnique({ where: { id: targetUserId } }),
        tx.user.findUnique({ where: { id: sourceUserId } }),
      ]);
      if (!target || !source) {
        throw new NotFoundException({
          message: 'User not found',
          errorCode: AUTH_ERRORS.USER_NOT_FOUND,
        });
      }

      // ── Auth providers ──
      await tx.oAuthProvider.updateMany({
        where: { userId: sourceUserId },
        data: { userId: targetUserId },
      });

      // ── Group memberships (unique on groupId+userId — drop duplicates) ──
      const targetMemberships = await tx.groupMembership.findMany({
        where: { userId: targetUserId },
        select: { groupId: true },
      });
      const targetGroupIds = targetMemberships.map((m) => m.groupId);
      if (targetGroupIds.length > 0) {
        await tx.groupMembership.deleteMany({
          where: { userId: sourceUserId, groupId: { in: targetGroupIds } },
        });
      }
      await tx.groupMembership.updateMany({
        where: { userId: sourceUserId },
        data: { userId: targetUserId },
      });

      // ── Plain-string ownership columns ──
      await tx.group.updateMany({
        where: { createdById: sourceUserId },
        data: { createdById: targetUserId },
      });
      await tx.groupInviteToken.updateMany({
        where: { createdById: sourceUserId },
        data: { createdById: targetUserId },
      });
      await tx.groupInviteToken.updateMany({
        where: { usedByUserId: sourceUserId },
        data: { usedByUserId: targetUserId },
      });

      // ── User-owned categories (unique on ownerType+ownerId+slug+direction) ──
      const [sourceCategories, targetCategories] = await Promise.all([
        tx.category.findMany({ where: { ownerType: 'user', ownerId: sourceUserId } }),
        tx.category.findMany({
          where: { ownerType: 'user', ownerId: targetUserId },
          select: { id: true, slug: true, direction: true },
        }),
      ]);
      for (const sourceCategory of sourceCategories) {
        const duplicate = targetCategories.find(
          (c) => c.slug === sourceCategory.slug && c.direction === sourceCategory.direction,
        );
        if (duplicate) {
          await tx.transaction.updateMany({
            where: { categoryId: sourceCategory.id },
            data: { categoryId: duplicate.id },
          });
          await tx.receiptItem.updateMany({
            where: { categoryId: sourceCategory.id },
            data: { categoryId: duplicate.id },
          });
          await tx.category.delete({ where: { id: sourceCategory.id } });
        } else {
          await tx.category.update({
            where: { id: sourceCategory.id },
            data: { ownerId: targetUserId },
          });
        }
      }

      // ── Transactions and satellites ──
      await tx.transaction.updateMany({
        where: { createdById: sourceUserId },
        data: { createdById: targetUserId },
      });

      // Attributions (unique on transactionId+scopeType+userId+groupId — drop duplicates)
      const [sourceAttributions, targetAttributions] = await Promise.all([
        tx.transactionAttribution.findMany({
          where: { userId: sourceUserId },
          select: { id: true, transactionId: true, scopeType: true },
        }),
        tx.transactionAttribution.findMany({
          where: { userId: targetUserId },
          select: { transactionId: true, scopeType: true },
        }),
      ]);
      const targetAttributionKeys = new Set(
        targetAttributions.map((a) => `${a.transactionId}:${a.scopeType}`),
      );
      const duplicateAttributionIds = sourceAttributions
        .filter((a) => targetAttributionKeys.has(`${a.transactionId}:${a.scopeType}`))
        .map((a) => a.id);
      if (duplicateAttributionIds.length > 0) {
        await tx.transactionAttribution.deleteMany({
          where: { id: { in: duplicateAttributionIds } },
        });
      }
      await tx.transactionAttribution.updateMany({
        where: { userId: sourceUserId },
        data: { userId: targetUserId },
      });

      // Stars (unique on transactionId+userId — drop duplicates)
      const [sourceStars, targetStars] = await Promise.all([
        tx.transactionStar.findMany({
          where: { userId: sourceUserId },
          select: { id: true, transactionId: true },
        }),
        tx.transactionStar.findMany({
          where: { userId: targetUserId },
          select: { transactionId: true },
        }),
      ]);
      const targetStarTransactionIds = new Set(targetStars.map((s) => s.transactionId));
      const duplicateStarIds = sourceStars
        .filter((s) => targetStarTransactionIds.has(s.transactionId))
        .map((s) => s.id);
      if (duplicateStarIds.length > 0) {
        await tx.transactionStar.deleteMany({ where: { id: { in: duplicateStarIds } } });
      }
      await tx.transactionStar.updateMany({
        where: { userId: sourceUserId },
        data: { userId: targetUserId },
      });

      await tx.transactionComment.updateMany({
        where: { userId: sourceUserId },
        data: { userId: targetUserId },
      });
      await tx.transactionDocument.updateMany({
        where: { uploadedById: sourceUserId },
        data: { uploadedById: targetUserId },
      });
      await tx.receipt.updateMany({
        where: { uploadedById: sourceUserId },
        data: { uploadedById: targetUserId },
      });

      // ── Credential adoption ──
      // Telegram-only targets carry a synthetic address — adopt the source's
      // real email (and its verification state) so email login / password
      // reset become possible. Adopt the password hash when the target has
      // none. The source row is deleted first so the unique email constraint
      // is never violated.
      const adoptEmail =
        AccountMergeService.isPlaceholderEmail(target.email) &&
        !AccountMergeService.isPlaceholderEmail(source.email);
      const adoptPassword = !target.passwordHash && !!source.passwordHash;

      // Cascades remove the source's refresh/verification/reset tokens.
      await tx.user.delete({ where: { id: sourceUserId } });

      if (adoptEmail || adoptPassword) {
        const data: Prisma.UserUpdateInput = {};
        if (adoptEmail) {
          data.email = source.email;
          data.emailVerified = source.emailVerified;
        }
        if (adoptPassword) {
          data.passwordHash = source.passwordHash;
        }
        await tx.user.update({ where: { id: targetUserId }, data });
      }

      await tx.auditLog.create({
        data: {
          userId: targetUserId,
          action: 'ACCOUNT_MERGED',
          entity: 'User',
          entityId: targetUserId,
          details: {
            sourceUserId,
            adoptedEmail: adoptEmail,
            adoptedPassword: adoptPassword,
          },
        },
      });
    });

    this.logger.log(`Merged account ${sourceUserId} into ${targetUserId}`);
  }
}
