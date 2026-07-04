import { CATEGORY_DIRECTIONS } from '@myfinpro/shared';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsHexColor, IsIn, IsOptional, IsString, Length } from 'class-validator';

export class UpdateCategoryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 32)
  icon?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsHexColor()
  color?: string;

  /**
   * Direction change is allowed only if the category has no Payment rows;
   * otherwise the service rejects with CATEGORY_IN_USE.
   */
  @ApiPropertyOptional({ enum: [...CATEGORY_DIRECTIONS] })
  @IsOptional()
  @IsIn([...CATEGORY_DIRECTIONS])
  direction?: 'IN' | 'OUT' | 'BOTH';
}
