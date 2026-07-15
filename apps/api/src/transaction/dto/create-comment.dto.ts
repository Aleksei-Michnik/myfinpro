import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

/**
 * Body for `POST /transactions/:transactionId/comments` — design §5.4 / iteration 6.10.
 * Markdown rendering / mentions / hashtags are out of scope (design §12).
 */
export class CreateCommentDto {
  @ApiProperty({ description: 'Comment text (1–2000 chars).' })
  @IsString()
  @Length(1, 2000)
  content!: string;
}
