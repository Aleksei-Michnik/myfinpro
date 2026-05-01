import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class DeleteCategoryQueryDto {
  /**
   * When provided, reassigns every payment using this category to the given one before deletion.
   * The replacement must match direction (with BOTH allowed as a superset).
   */
  @ApiPropertyOptional({ description: 'UUID of a replacement category.' })
  @IsOptional()
  @IsUUID()
  replaceWithCategoryId?: string;
}
