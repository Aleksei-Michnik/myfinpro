import { CATEGORY_DIRECTIONS } from '@myfinpro/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsHexColor, IsIn, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

export class CreateCategoryDto {
  @ApiProperty({ description: 'Display name.', example: 'Coffee shops' })
  @IsString()
  @Length(1, 100)
  name!: string;

  @ApiPropertyOptional({
    description: 'Stable slug; auto-generated from name if omitted.',
    example: 'coffee_shops',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9_-]+$/)
  @Length(1, 64)
  slug?: string;

  @ApiPropertyOptional({ example: 'coffee' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  icon?: string;

  @ApiPropertyOptional({ example: '#ff8800' })
  @IsOptional()
  @IsHexColor()
  color?: string;

  @ApiProperty({ enum: [...CATEGORY_DIRECTIONS], example: 'OUT' })
  @IsIn([...CATEGORY_DIRECTIONS])
  direction!: 'IN' | 'OUT' | 'BOTH';

  /** 'personal' | 'group' — system cannot be chosen. */
  @ApiProperty({ example: 'personal', enum: ['personal', 'group'] })
  @IsIn(['personal', 'group'])
  scope!: 'personal' | 'group';

  @ApiPropertyOptional({ description: 'Required when scope=group.' })
  @IsOptional()
  @IsUUID()
  groupId?: string;
}
