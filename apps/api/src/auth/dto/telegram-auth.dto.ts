import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

/**
 * Telegram Login Widget hash-based auth data.
 *
 * Telegram does NOT support native OIDC — the Login Widget returns
 * user data signed with HMAC-SHA256 using the bot token as key.
 *
 * @see https://core.telegram.org/widgets/login#checking-authorization
 */
export class TelegramAuthDto {
  @ApiProperty({ example: 123456789, description: 'Telegram user ID' })
  @IsNumber()
  id: number;

  @ApiProperty({ example: 'John', description: 'User first name' })
  @IsString()
  @IsNotEmpty()
  first_name: string;

  @ApiPropertyOptional({ example: 'Doe', description: 'User last name' })
  @IsString()
  @IsOptional()
  last_name?: string;

  @ApiPropertyOptional({ example: 'johndoe', description: 'Telegram username' })
  @IsString()
  @IsOptional()
  username?: string;

  @ApiPropertyOptional({
    example: 'https://t.me/i/userpic/320/photo.jpg',
    description: 'Profile photo URL',
  })
  @IsString()
  @IsOptional()
  photo_url?: string;

  @ApiProperty({ example: 1700000000, description: 'Unix timestamp of authentication' })
  @IsNumber()
  auth_date: number;

  @ApiProperty({
    example: 'aabbccdd00112233...',
    description: 'HMAC-SHA256 hash for data verification',
  })
  @IsString()
  @IsNotEmpty()
  hash: string;
}
