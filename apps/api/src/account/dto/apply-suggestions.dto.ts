import { ACCOUNT_IMPORT_MAX_LINES } from '@myfinpro/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsUUID } from 'class-validator';

/**
 * POST /accounts/:id/lines/apply-suggestions body (design §6.2) — "apply all
 * confident suggestions" for the impatient. Omit `lineIds` for every pending
 * line of the account.
 */
export class ApplySuggestionsDto {
  @ApiPropertyOptional({
    type: [String],
    maxItems: ACCOUNT_IMPORT_MAX_LINES,
    description: 'Restrict the run to these lines; all pending lines when omitted.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ACCOUNT_IMPORT_MAX_LINES)
  @IsUUID(undefined, { each: true })
  lineIds?: string[];
}

/** What an apply-all run did. Anything not confident is `skipped`. */
export class ApplySuggestionsResultDto {
  @ApiProperty() matched!: number;
  @ApiProperty() transferred!: number;
  @ApiProperty() created!: number;
  @ApiProperty() skipped!: number;
}
