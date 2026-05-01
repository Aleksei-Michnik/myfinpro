import { PAYMENT_DIRECTIONS } from '@myfinpro/shared';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

export class ListCategoriesQueryDto {
  @ApiPropertyOptional({
    enum: [...PAYMENT_DIRECTIONS],
    description: 'Filter by direction (IN / OUT). BOTH categories match either.',
  })
  @IsOptional()
  @IsIn([...PAYMENT_DIRECTIONS])
  direction?: 'IN' | 'OUT';

  /**
   * One of:
   *   - 'system'
   *   - 'personal'
   *   - 'group:<groupId>'
   *   - 'all' (default — system + personal + all member groups)
   */
  @ApiPropertyOptional({
    description: 'Scope filter. Values: system | personal | group:<id> | all (default: all).',
    example: 'all',
  })
  @IsOptional()
  @IsString()
  @Matches(/^(all|system|personal|group:[a-zA-Z0-9-]{1,36})$/)
  scope?: string;
}
