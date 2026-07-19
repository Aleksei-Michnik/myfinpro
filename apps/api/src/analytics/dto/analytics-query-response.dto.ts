import type { AnalyticsResultKeys } from '@myfinpro/shared';
import { ApiProperty } from '@nestjs/swagger';

/** One aggregate bucket (design §2.5). Rows never mix currencies. */
export class AnalyticsResultRowDto {
  @ApiProperty({
    description:
      'Key per requested dimension: {id,name} refs for category/merchant/product/member/group ' +
      '(null id = "no value" bucket), {scopeType,group?} for scope, a bucket string for period.',
    type: 'object',
    additionalProperties: true,
    example: { category: { id: 'uuid', name: 'Groceries' }, period: '2026-06' },
  })
  keys!: AnalyticsResultKeys;

  @ApiProperty({ example: 'ILS' })
  currency!: string;

  @ApiProperty({ description: 'Sum of purchase rows in minor units.' })
  spendCents!: number;

  @ApiProperty({ description: 'Distinct transactions contributing to the bucket.' })
  transactionCount!: number;

  @ApiProperty({ description: 'Receipt-item rows contributing (0 = header-only spend).' })
  itemCount!: number;
}

export class AnalyticsQueryResponseDto {
  @ApiProperty({ type: [AnalyticsResultRowDto] })
  data!: AnalyticsResultRowDto[];

  @ApiProperty({ nullable: true, description: 'Opaque cursor for the next page.' })
  cursor!: string | null;

  @ApiProperty()
  hasMore!: boolean;
}
