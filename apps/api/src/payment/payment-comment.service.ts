import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventBus } from '../realtime/event-bus.service';
import { PAYMENT_ERRORS } from './constants/payment-errors';
import { CommentListResponseDto, CommentResponseDto } from './dto/comment-response.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { ListCommentsQueryDto } from './dto/list-comments-query.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { PaymentService } from './payment.service';
import {
  computePaymentRecipients,
  type RecipientAttribution,
} from './utils/payment-event-recipients';

/** Shape the service needs from a PaymentComment row + its author relation. */
type CommentRow = {
  id: string;
  paymentId: string;
  userId: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  user: { id: string; name: string };
};

type CommentCursor = { c: string; id: string };

/**
 * Comments API on payments (iteration 6.10, design §5.4 + §2.6).
 *
 * Visibility: any user with payment access can read & write (delegated to
 * `PaymentService.assertVisible`). Authorship: only the author can edit or
 * soft-delete their comment — group-admin override is deferred (design §2.6).
 * Soft-delete preserves the row for cascade + audit but zeroes `content`.
 *
 * Iteration 6.18.1.4.2 wires the realtime EventBus: every successful
 * create / update / soft-delete fans a `comment.*` event out to the same
 * recipient set as the parent payment (creator ∪ personal attribution
 * users ∪ group-attribution members). Emission is POST-commit and
 * best-effort; a failed publish never breaks the user-facing operation.
 */
@Injectable()
export class PaymentCommentService {
  private readonly logger = new Logger(PaymentCommentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentService: PaymentService,
    private readonly eventBus: EventBus,
  ) {}

  async list(
    userId: string,
    paymentId: string,
    q: ListCommentsQueryDto,
  ): Promise<CommentListResponseDto> {
    await this.paymentService.assertVisible(userId, paymentId);

    const limit = Math.min(Math.max(q.limit ?? 20, 1), 100);

    const where: Prisma.PaymentCommentWhereInput = { paymentId, deletedAt: null };
    if (q.cursor) {
      const decoded = decodeCommentCursor(q.cursor);
      if (!decoded) {
        throw new BadRequestException({
          message: 'Malformed cursor',
          errorCode: PAYMENT_ERRORS.PAYMENT_COMMENT_INVALID_CURSOR,
        });
      }
      const d = new Date(decoded.c);
      where.AND = [
        {
          OR: [{ createdAt: { gt: d } }, { createdAt: d, id: { gt: decoded.id } }],
        },
      ];
    }

    const rows = await this.prisma.paymentComment.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      include: { user: { select: { id: true, name: true } } },
    });

    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;
    const data = slice.map((r) => this.toDto(r as CommentRow, userId));
    const nextCursor = hasMore
      ? encodeCommentCursor({
          c: slice[slice.length - 1].createdAt.toISOString(),
          id: slice[slice.length - 1].id,
        })
      : null;
    return { data, nextCursor, hasMore };
  }

  async create(
    userId: string,
    paymentId: string,
    dto: CreateCommentDto,
  ): Promise<CommentResponseDto> {
    await this.paymentService.assertVisible(userId, paymentId);

    const created = await this.prisma.paymentComment.create({
      data: { paymentId, userId, content: dto.content },
      include: { user: { select: { id: true, name: true } } },
    });

    void this.writeAudit(userId, paymentId, 'PAYMENT_COMMENT_CREATED', {
      commentId: created.id,
    });

    this.logger.log(
      `PaymentComment ${created.id} created by user ${userId} on payment ${paymentId}`,
    );

    // The DTO is shaped for the author (`isMine: true`); recipients other
    // than the author will see it as "not mine" once their client patches
    // the row in. We emit one event with the author's view because every
    // browser computes `isMine` locally from `author.id` against its own
    // session anyway — frontend logic doesn't read this flag off the wire.
    const dtoOut = this.toDto(created as CommentRow, userId);
    await this.publishCommentEvent({
      type: 'comment.created',
      paymentId,
      comment: dtoOut,
    });
    return dtoOut;
  }

  async update(
    userId: string,
    paymentId: string,
    commentId: string,
    dto: UpdateCommentDto,
  ): Promise<CommentResponseDto> {
    await this.paymentService.assertVisible(userId, paymentId);

    const existing = await this.prisma.paymentComment.findFirst({
      where: { id: commentId, paymentId },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Comment not found',
        errorCode: PAYMENT_ERRORS.PAYMENT_COMMENT_NOT_FOUND,
      });
    }
    if (existing.deletedAt !== null) {
      // 410 Gone — distinct from 404 so the UI can render "this comment was
      // deleted" rather than a generic not-found (design §6.10 decision).
      throw new HttpException(
        {
          message: 'Comment has been deleted',
          errorCode: PAYMENT_ERRORS.PAYMENT_COMMENT_DELETED,
        },
        HttpStatus.GONE,
      );
    }
    if (existing.userId !== userId) {
      throw new ForbiddenException({
        message: 'Only the author can edit this comment',
        errorCode: PAYMENT_ERRORS.PAYMENT_COMMENT_NOT_AUTHOR,
      });
    }

    const updated = await this.prisma.paymentComment.update({
      where: { id: commentId },
      data: { content: dto.content },
      include: { user: { select: { id: true, name: true } } },
    });

    void this.writeAudit(userId, paymentId, 'PAYMENT_COMMENT_UPDATED', {
      commentId,
    });

    this.logger.log(`PaymentComment ${commentId} updated by user ${userId}`);

    const dtoOut = this.toDto(updated as CommentRow, userId);
    await this.publishCommentEvent({
      type: 'comment.updated',
      paymentId,
      comment: dtoOut,
    });
    return dtoOut;
  }

  async remove(userId: string, paymentId: string, commentId: string): Promise<void> {
    await this.paymentService.assertVisible(userId, paymentId);

    const existing = await this.prisma.paymentComment.findFirst({
      where: { id: commentId, paymentId },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Comment not found',
        errorCode: PAYMENT_ERRORS.PAYMENT_COMMENT_NOT_FOUND,
      });
    }
    if (existing.deletedAt !== null) {
      throw new HttpException(
        {
          message: 'Comment has been deleted',
          errorCode: PAYMENT_ERRORS.PAYMENT_COMMENT_DELETED,
        },
        HttpStatus.GONE,
      );
    }
    if (existing.userId !== userId) {
      throw new ForbiddenException({
        message: 'Only the author can delete this comment',
        errorCode: PAYMENT_ERRORS.PAYMENT_COMMENT_NOT_AUTHOR,
      });
    }

    await this.prisma.paymentComment.update({
      where: { id: commentId },
      data: { deletedAt: new Date(), content: '' },
    });

    void this.writeAudit(userId, paymentId, 'PAYMENT_COMMENT_DELETED', {
      commentId,
    });

    this.logger.log(`PaymentComment ${commentId} soft-deleted by user ${userId}`);

    await this.publishCommentEvent({
      type: 'comment.deleted',
      paymentId,
      commentId,
    });
  }

  // ── helpers ──

  private toDto(row: CommentRow, viewerId: string): CommentResponseDto {
    return {
      id: row.id,
      paymentId: row.paymentId,
      author: { id: row.user.id, name: row.user.name },
      content: row.content,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
      isMine: row.userId === viewerId,
    };
  }

  /**
   * Resolve the multicast recipient list for the comment's parent payment
   * and publish on the EventBus. Failures are swallowed + logged so a
   * Redis/queue blip never breaks the user-facing comment operation —
   * comments stay durable in MySQL; clients re-sync via polling / refetch
   * on reconnect (see `docs/ui-realtime-conventions.md`).
   */
  private async publishCommentEvent(
    payload:
      | { type: 'comment.created'; paymentId: string; comment: CommentResponseDto }
      | { type: 'comment.updated'; paymentId: string; comment: CommentResponseDto }
      | { type: 'comment.deleted'; paymentId: string; commentId: string },
  ): Promise<void> {
    try {
      const parent = await this.prisma.payment.findUnique({
        where: { id: payload.paymentId },
        select: {
          createdById: true,
          attributions: { select: { scopeType: true, userId: true, groupId: true } },
        },
      });
      if (!parent) {
        // Defensive — `assertVisible` ran earlier in the public methods, so
        // the parent should always exist here.
        return;
      }
      const userIds = await computePaymentRecipients(
        this.prisma,
        parent.attributions as RecipientAttribution[],
        parent.createdById,
      );
      if (payload.type === 'comment.deleted') {
        this.eventBus.publish({
          type: 'comment.deleted',
          userIds,
          paymentId: payload.paymentId,
          commentId: payload.commentId,
        });
      } else {
        this.eventBus.publish({
          type: payload.type,
          userIds,
          paymentId: payload.paymentId,
          comment: payload.comment,
        });
      }
    } catch (err) {
      this.logger.warn(
        `Failed to publish ${payload.type} for payment ${payload.paymentId}: ${(err as Error).message}`,
      );
    }
  }

  private async writeAudit(
    userId: string,
    paymentId: string,
    action: 'PAYMENT_COMMENT_CREATED' | 'PAYMENT_COMMENT_UPDATED' | 'PAYMENT_COMMENT_DELETED',
    details: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId,
          action,
          entity: 'Payment',
          entityId: paymentId,
          details: details as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to write audit log for ${action} ${paymentId}: ${(err as Error).message}`,
      );
    }
  }
}

// ── cursor helpers (co-located, mirror payment.service.ts style) ──

export function encodeCommentCursor(cursor: CommentCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCommentCursor(raw: string): CommentCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const c = parsed as Partial<CommentCursor>;
    if (typeof c.c !== 'string' || typeof c.id !== 'string') return null;
    if (Number.isNaN(new Date(c.c).getTime())) return null;
    return { c: c.c, id: c.id };
  } catch {
    return null;
  }
}
