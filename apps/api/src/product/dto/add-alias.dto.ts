import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsLocale, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Phase 8.2 — POST /products/:id/aliases body. Upserts on the normalized
 * spelling: an existing alias gets its confirmation count bumped instead
 * of a duplicate row (design §1.3).
 */
export class AddAliasDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  name!: string;

  @ApiPropertyOptional({ description: 'BCP-47 language of the alias.' })
  @IsOptional()
  @IsLocale()
  locale?: string;
}
