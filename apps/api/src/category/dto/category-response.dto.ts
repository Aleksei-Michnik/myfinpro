import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CategoryResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  icon?: string | null;

  @ApiPropertyOptional({ nullable: true })
  color?: string | null;

  @ApiProperty({ enum: ['IN', 'OUT', 'BOTH'] })
  direction!: 'IN' | 'OUT' | 'BOTH';

  @ApiProperty({ enum: ['system', 'user', 'group'] })
  ownerType!: 'system' | 'user' | 'group';

  @ApiPropertyOptional({ nullable: true })
  ownerId?: string | null;

  @ApiProperty()
  isSystem!: boolean;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}
