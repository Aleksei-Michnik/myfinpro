import { CURRENCY_CODES, GROUP_TYPES } from '@myfinpro/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateGroupDto {
  @ApiProperty({ description: 'Group name', example: 'My Family' })
  @IsString()
  @IsNotEmpty({ message: 'Name is required' })
  @MaxLength(100, { message: 'Name must not exceed 100 characters' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name: string;

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
