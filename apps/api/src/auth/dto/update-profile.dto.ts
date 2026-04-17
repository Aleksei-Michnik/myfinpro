import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsIn } from 'class-validator';
import { LOCALES } from '@myfinpro/shared';

const VALID_CURRENCIES = ['USD', 'EUR', 'GBP', 'ILS', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'RUB'];

export class UpdateProfileDto {
  @ApiPropertyOptional({ description: 'Default currency (ISO 4217)', example: 'USD' })
  @IsOptional()
  @IsString()
  @IsIn(VALID_CURRENCIES)
  defaultCurrency?: string;

  @ApiPropertyOptional({ description: 'User timezone (IANA)', example: 'Asia/Jerusalem' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({ description: 'User locale', example: 'en', enum: [...LOCALES] })
  @IsOptional()
  @IsString()
  @IsIn(LOCALES)
  locale?: string;
}
