import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

/**
 * Query params for `DELETE /payments/:id` (iteration 6.8).
 *
 * When `scope` is absent the service infers a default:
 *  - exactly one accessible attribution → removed
 *  - multiple accessible attributions → 409 PAYMENT_SCOPE_AMBIGUOUS
 *
 * See design §2.4 "Delete semantics" / §5.2.
 */
export class DeletePaymentQueryDto {
  @ApiPropertyOptional({
    description:
      'Scope to remove: "all" | "personal" | "group:<uuid>". Omit to let the server pick when unambiguous.',
    example: 'personal',
  })
  @IsOptional()
  @IsString()
  @Matches(/^(all|personal|group:[a-zA-Z0-9-]{1,36})$/)
  scope?: string;
}
