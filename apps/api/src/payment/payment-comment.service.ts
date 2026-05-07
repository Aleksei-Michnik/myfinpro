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
import { PAYMENT_ERRORS } from './constants/payment-errors';
import { CommentListResponseDto, CommentResponseDto } from './dto/comment-response.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { ListCommentsQueryDto } from './dto/list-comments-query.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { PaymentService } from './payment.service';

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
 */
@Injectable()
export class PaymentCommentService {
  private readonly logger = new Logger(PaymentCommentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentService: PaymentService,
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
    return this.toDto(created as CommentRow, userId);
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
    return this.toDto(updated as CommentRow, userId);
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
