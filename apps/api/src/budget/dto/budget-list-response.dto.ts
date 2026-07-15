import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BudgetResponseDto } from './budget-response.dto';

/**
 * Paginated envelope for GET /budgets — same cursor contract as
 * GET /transactions (`nextCursor` is an opaque base64url payload the client
 * echoes back verbatim).
 */
export class BudgetListResponseDto {
  @ApiProperty({ type: [BudgetResponseDto] })
  data!: BudgetResponseDto[];

  @ApiPropertyOptional({
    nullable: true,
    description: 'Opaque cursor for the next page, null when no more pages.',
  })
  nextCursor!: string | null;

  @ApiProperty()
  hasMore!: boolean;
}
