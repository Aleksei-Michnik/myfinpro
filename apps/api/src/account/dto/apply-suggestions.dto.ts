import { APPLY_SUGGESTIONS_BATCH_SIZE } from '../statement-line.service';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsUUID } from 'class-validator';

/**
 * POST /accounts/:id/lines/apply-suggestions body (design §6.2) — "apply all
 * confident suggestions" for the impatient. Omit `lineIds` for the account's
 * pending lines, oldest first; one call decides at most
 * `APPLY_SUGGESTIONS_BATCH_SIZE` of them and reports how many are left.
 */
export class ApplySuggestionsDto {
  @ApiPropertyOptional({
    type: [String],
    maxItems: APPLY_SUGGESTIONS_BATCH_SIZE,
    description: 'Restrict the run to these lines; all pending lines when omitted.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(APPLY_SUGGESTIONS_BATCH_SIZE)
  @IsUUID(undefined, { each: true })
  lineIds?: string[];
}

/** What an apply-all run did. Anything not confident is `skipped`. */
export class ApplySuggestionsResultDto {
  @ApiProperty() matched!: number;
  @ApiProperty() transferred!: number;
  @ApiProperty() created!: number;
  @ApiProperty() skipped!: number;
  @ApiProperty({
    description:
      'Pending lines the batch cap left for a follow-up call — 0 when the queue is drained.',
  })
  remaining!: number;
}
