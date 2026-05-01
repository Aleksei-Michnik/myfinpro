import { ATTRIBUTION_SCOPE_TYPES } from '@myfinpro/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';

/**
 * One attribution target on a POST /payments body.
 *
 *   { scope: 'personal' }                       — attributed to the caller
 *   { scope: 'group', groupId: '<uuid>' }       — attributed to a group the caller belongs to
 */
export class AttributionDto {
  @ApiProperty({ enum: [...ATTRIBUTION_SCOPE_TYPES], description: 'Attribution scope.' })
  @IsIn([...ATTRIBUTION_SCOPE_TYPES])
  scope!: 'personal' | 'group';

  @ApiPropertyOptional({ description: 'Required when scope=group.' })
  @IsOptional()
  @IsUUID()
  groupId?: string;
}
