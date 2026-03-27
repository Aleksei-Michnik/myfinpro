import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class TelegramAuthDto {
  @ApiProperty({ example: 123456789, description: 'Telegram user ID' })
  @IsInt({ message: 'Telegram user ID must be an integer' })
  id: number;

  @ApiProperty({ example: 'John', description: 'Telegram first name' })
  @IsString()
  @IsNotEmpty({ message: 'First name is required' })
  first_name: string;

  @ApiPropertyOptional({ example: 'Doe', description: 'Telegram last name' })
  @IsOptional()
  @IsString()
  last_name?: string;

  @ApiPropertyOptional({ example: 'johndoe', description: 'Telegram username' })
  @IsOptional()
  @IsString()
  username?: string;

  @ApiPropertyOptional({
    example: 'https://t.me/i/userpic/320/photo.jpg',
    description: 'Telegram profile photo URL',
  })
  @IsOptional()
  @IsString()
  photo_url?: string;

  @ApiProperty({ example: 1700000000, description: 'Unix timestamp of authentication' })
  @IsInt({ message: 'auth_date must be an integer' })
  auth_date: number;

  @ApiProperty({
    example: 'a1b2c3d4e5f6...',
    description: 'HMAC-SHA256 hash for verification',
  })
  @IsString()
  @IsNotEmpty({ message: 'Hash is required' })
  hash: string;
}
