import { CURRENCY_CODES, GROUP_TYPES } from '@myfinpro/shared';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateGroupDto {
  @ApiPropertyOptional({ description: 'Group name', example: 'My Family' })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Name must not be empty' })
  @MaxLength(100, { message: 'Name must not exceed 100 characters' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name?: string;

  @ApiPropertyOptional({
    description: 'Group type',
    example: 'family',
    enum: [...GROUP_TYPES],
  })
  @IsOptional()
  @IsString()
  @IsIn([...GROUP_TYPES], { message: 'Invalid group type' })
  type?: string;

  @ApiPropertyOptional({ description: 'Default currency (ISO 4217)', example: 'USD' })
  @IsOptional()
  @IsString()
  @IsIn([...CURRENCY_CODES], { message: 'Invalid currency code' })
  defaultCurrency?: string;
}
