import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccountResponseDto } from './account-response.dto';

/**
 * Paginated envelope for GET /accounts — same cursor contract as
 * GET /budgets and GET /transactions (`nextCursor` is an opaque base64url
 * payload the client echoes back verbatim).
 */
export class AccountListResponseDto {
  @ApiProperty({ type: [AccountResponseDto] })
  data!: AccountResponseDto[];

  @ApiPropertyOptional({
    nullable: true,
    description: 'Opaque cursor for the next page, null when no more pages.',
  })
  nextCursor!: string | null;

  @ApiProperty()
  hasMore!: boolean;
}
