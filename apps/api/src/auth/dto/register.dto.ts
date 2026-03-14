import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CURRENCY_CODES, LOCALES } from '@myfinpro/shared';

export class RegisterDto {
  @ApiProperty({ example: 'user@example.com', description: 'User email address' })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @Transform(({ value }) => value?.toLowerCase().trim())
  email: string;

  @ApiProperty({
    example: 'SecurePass123',
    description: 'Password (min 8 chars, must contain uppercase, lowercase, and number)',
  })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(128, { message: 'Password must not exceed 128 characters' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message:
      'Password must contain at least one uppercase letter, one lowercase letter, and one number',
  })
  password: string;

  @ApiProperty({ example: 'John Doe', description: 'Full name' })
  @IsString()
  @MinLength(1, { message: 'Name is required' })
  @MaxLength(100, { message: 'Name must not exceed 100 characters' })
  @Transform(({ value }) => value?.trim())
  name: string;

  @ApiProperty({ example: 'USD', description: 'Default currency (ISO 4217)', required: false })
  @IsOptional()
  @IsIn([...CURRENCY_CODES], { message: 'Invalid currency code' })
  defaultCurrency?: string;

  @ApiProperty({ example: 'en', description: 'Preferred locale', required: false })
  @IsOptional()
  @IsIn([...LOCALES], { message: 'Invalid locale' })
  locale?: string;
}
