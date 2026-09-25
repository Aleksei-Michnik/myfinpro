// Phase 20 — the two side effects every account mutation has: an audit row
// and the advisory `account.updated` realtime event (design §2.6, §6.2).
//
// Lifted out of `AccountService` in 20.4 so the import and statement-line
// services fire exactly the same ones — recipients and entity names cannot
// drift between the CRUD surface and the review queue.

import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { EventBus } from '../../realtime/event-bus.service';
import { computeTransactionRecipients } from '../../transaction/utils/transaction-event-recipients';

/** Every audited action of the accounts domain (design §6.2). */
export type AccountAuditAction =
  | 'ACCOUNT_CREATED'
  | 'ACCOUNT_UPDATED'
  | 'ACCOUNT_DELETED'
  | 'ACCOUNT_ARCHIVED'
  | 'ACCOUNT_UNARCHIVED'
  | 'ACCOUNT_IMPORT_CREATED'
  | 'STATEMENT_LINE_MATCHED'
  | 'STATEMENT_LINE_CREATED'
  | 'STATEMENT_LINE_TRANSFERRED'
  | 'STATEMENT_LINE_IGNORED'
  | 'STATEMENT_LINE_UNLINKED';

/** The entity an audit row points at, by action. */
const AUDIT_ENTITY: Record<AccountAuditAction, string> = {
  ACCOUNT_CREATED: 'Account',
  ACCOUNT_UPDATED: 'Account',
  ACCOUNT_DELETED: 'Account',
  ACCOUNT_ARCHIVED: 'Account',
  ACCOUNT_UNARCHIVED: 'Account',
  ACCOUNT_IMPORT_CREATED: 'AccountImport',
  STATEMENT_LINE_MATCHED: 'AccountStatementLine',
  STATEMENT_LINE_CREATED: 'AccountStatementLine',
  STATEMENT_LINE_TRANSFERRED: 'AccountStatementLine',
  STATEMENT_LINE_IGNORED: 'AccountStatementLine',
  STATEMENT_LINE_UNLINKED: 'AccountStatementLine',
};

/**
 * Write one audit row. Never throws — an audit failure must not fail the
 * request that earned it (same contract as the transaction domain's writer).
 * `details` must never carry statement text beyond a description (design §9).
 */
export async function writeAccountAudit(
  prisma: PrismaService,
  logger: Logger,
  params: {
    userId: string;
    action: AccountAuditAction;
    entityId: string;
    details: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        entity: AUDIT_ENTITY[params.action],
        entityId: params.entityId,
        details: params.details as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    logger.warn(
      `Failed to write audit log for ${params.action} ${params.entityId}: ${(err as Error).message}`,
    );
  }
}

/** The scope fields the recipient computation needs from an account. */
export interface AccountScopeRef {
  id: string;
  scopeType: string;
  ownerId: string | null;
  groupId: string | null;
}

/**
 * Publish the advisory `account.updated` event (design §2.6). An account's
 * scope maps 1:1 onto the attribution shape the transaction recipient util
 * understands, so recipients — the owner (personal) or every group member
 * (group), plus the actor — are computed by one code path for budgets,
 * transactions and accounts alike.
 */
export async function publishAccountUpdated(
  prisma: PrismaService,
  eventBus: EventBus,
  account: AccountScopeRef,
  actorId: string,
): Promise<void> {
  const recipients = await computeTransactionRecipients(
    prisma,
    [{ scopeType: account.scopeType, userId: account.ownerId, groupId: account.groupId }],
    actorId,
  );
  eventBus.publish({ type: 'account.updated', userIds: recipients, accountId: account.id });
}
