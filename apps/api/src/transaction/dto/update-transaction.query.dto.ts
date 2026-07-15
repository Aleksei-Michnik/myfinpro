import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

/**
 * Propagation modes for PATCH /transactions/:id (Phase 6 · Iteration 6.18.1.5).
 *
 * - `self`   — update the parent record only. Children untouched. DEFAULT.
 * - `future` — update the parent + every child occurrence whose
 *              `occurredAt >= now` (server-evaluated). Past children untouched.
 * - `all`    — update the parent + every child occurrence (past and future).
 *
 * For non-RECURRING / childless transactions `propagate` is ignored (always
 * effectively `self`). Because the cascade in this iteration only overwrites
 * non-period scalar/attribution fields (no occurrence add/remove), `all` and
 * `future` differ solely by the `occurredAt` cutoff applied to which children
 * receive the new values — there is no destructive regeneration yet (that
 * lands in 6.18.1.5.2).
 */
export const TRANSACTION_PROPAGATE_MODES = ['self', 'future', 'all'] as const;
export type TransactionPropagateMode = (typeof TRANSACTION_PROPAGATE_MODES)[number];

/** Query params for PATCH /transactions/:id. */
export class UpdateTransactionQueryDto {
  @ApiPropertyOptional({
    enum: [...TRANSACTION_PROPAGATE_MODES],
    default: 'self',
    description:
      'How far a parent edit reaches: self (parent only), future (parent + children with ' +
      'occurredAt >= now), all (parent + every child). Ignored for non-recurring / childless transactions.',
  })
  @IsOptional()
  @IsIn([...TRANSACTION_PROPAGATE_MODES])
  propagate?: TransactionPropagateMode;
}
