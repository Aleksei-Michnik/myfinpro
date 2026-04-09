import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty } from 'class-validator';

export class DeleteAccountDto {
  @ApiProperty({
    description: 'User must type their email to confirm account deletion',
    example: 'user@example.com',
  })
  @IsEmail()
  @IsNotEmpty()
  confirmation: string;
}
