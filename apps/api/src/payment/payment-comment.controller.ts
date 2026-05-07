import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiGoneResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CustomThrottle } from '../common/decorators/throttle.decorator';
import { CommentListResponseDto, CommentResponseDto } from './dto/comment-response.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { ListCommentsQueryDto } from './dto/list-comments-query.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { PaymentCommentService } from './payment-comment.service';

/**
 * `GET / POST / PATCH / DELETE /payments/:paymentId/comments[/:commentId]`
 *
 * Visibility: any user with payment access can read & write (delegated).
 * Authorship: only the author can edit/soft-delete (group admin override
 * deferred — design §2.6). Rate limits per design §5.8.
 */
@ApiTags('Payments')
@Controller('payments/:paymentId/comments')
export class PaymentCommentController {
  constructor(private readonly service: PaymentCommentService) {}

  @CustomThrottle({ limit: 120, ttl: 60000 })
  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List comments on a payment (cursor-paginated, oldest-first)',
    description:
      'Soft-deleted rows are excluded. Cursor is an opaque base64url blob produced by the server.',
  })
  @ApiOkResponse({ description: 'Paginated comments envelope', type: CommentListResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid query parameters or cursor' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiNotFoundResponse({ description: 'Payment not found or not visible to the caller' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (120/min)' })
  async list(
    @CurrentUser() user: JwtPayload,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Query() q: ListCommentsQueryDto,
  ): Promise<CommentListResponseDto> {
    return this.service.list(user.sub, paymentId, q);
  }

  @CustomThrottle({ limit: 20, ttl: 60000 })
  @UseGuards(JwtAuthGuard)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a comment on a payment' })
  @ApiBody({ type: CreateCommentDto })
  @ApiCreatedResponse({ description: 'Comment created', type: CommentResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiNotFoundResponse({ description: 'Payment not found or not visible to the caller' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (20/min)' })
  async create(
    @CurrentUser() user: JwtPayload,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() dto: CreateCommentDto,
  ): Promise<CommentResponseDto> {
    return this.service.create(user.sub, paymentId, dto);
  }

  @CustomThrottle({ limit: 20, ttl: 60000 })
  @UseGuards(JwtAuthGuard)
  @Patch(':commentId')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Edit own comment',
    description:
      'Only the original author may edit (group-admin override deferred — design §2.6). ' +
      'Returns 410 Gone if the comment has been soft-deleted.',
  })
  @ApiBody({ type: UpdateCommentDto })
  @ApiOkResponse({ description: 'Updated comment', type: CommentResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiForbiddenResponse({ description: 'Caller is not the author' })
  @ApiNotFoundResponse({ description: 'Comment or payment not found / not visible' })
  @ApiGoneResponse({ description: 'Comment has been soft-deleted' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (20/min)' })
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() dto: UpdateCommentDto,
  ): Promise<CommentResponseDto> {
    return this.service.update(user.sub, paymentId, commentId, dto);
  }

  @CustomThrottle({ limit: 20, ttl: 60000 })
  @UseGuards(JwtAuthGuard)
  @Delete(':commentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Soft-delete own comment',
    description:
      'Sets `deletedAt` and clears `content`. The row persists to support audit + cascade. ' +
      'Only the author may delete (group-admin override deferred — design §2.6).',
  })
  @ApiNoContentResponse({ description: 'Comment soft-deleted' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiForbiddenResponse({ description: 'Caller is not the author' })
  @ApiNotFoundResponse({ description: 'Comment or payment not found / not visible' })
  @ApiGoneResponse({ description: 'Comment has already been soft-deleted' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (20/min)' })
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ): Promise<void> {
    await this.service.remove(user.sub, paymentId, commentId);
  }
}
