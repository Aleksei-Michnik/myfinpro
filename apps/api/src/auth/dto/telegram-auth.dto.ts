import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class TelegramAuthDto {
  @ApiProperty({
    example: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...',
    description: 'OIDC id_token JWT from Telegram Login SDK',
  })
  @IsString()
  @IsNotEmpty({ message: 'id_token is required' })
  id_token: string;
}
