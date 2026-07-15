import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

/**
 * Body for `PATCH /transactions/:transactionId/comments/:commentId`.
 *
 * `content` is required (1–2000 chars). Empty strings are rejected — callers
 * that want to "clear" a comment should issue DELETE instead (which soft-
 * deletes and zeroes `content` server-side per design §10).
 */
export class UpdateCommentDto {
  @ApiProperty({ description: 'New comment text (1–2000 chars).' })
  @IsString()
  @Length(1, 2000)
  content!: string;
}
