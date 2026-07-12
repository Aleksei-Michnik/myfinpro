import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsLocale,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Phase 8.2 — POST /products body. Creating publishes to the GLOBAL
 * registry (design §1.1): barcode is checksum-validated + uniqueness-
 * checked in the service; defaultCategoryId must be a system OUT category
 * so the reference is meaningful for every user.
 */
export class CreateProductDto {
  @ApiProperty({ description: 'Canonical display name.' })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  name!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  brand?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'GTIN-8/12/13/14; digits (whitespace/hyphens tolerated).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  barcode?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, description: 'System OUT category id.' })
  @IsOptional()
  @IsUUID()
  defaultCategoryId?: string | null;

  @ApiPropertyOptional({ description: 'BCP-47 locale recorded on the seeded alias.' })
  @IsOptional()
  @IsLocale()
  aliasLocale?: string;

  @ApiPropertyOptional({
    description:
      'https image to fetch in the background (Open Food Facts prefill, design §1.4/§1.5).',
  })
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(1000)
  imageUrl?: string;
}
