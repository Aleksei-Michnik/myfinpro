import { API_TOKEN_NAME_MAX_LENGTH, API_TOKEN_SCOPES, type ApiTokenScope } from '@myfinpro/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

/**
 * POST /auth/tokens body — Phase 20.7 (design §6.4).
 *
 * `scopes` defaults to `['accounts:import']`, the only scope v1 knows; the
 * cap on active tokens is enforced in the service, where the count lives.
 */
export class CreateApiTokenDto {
  @ApiProperty({
    description: 'Human label shown in settings, e.g. the machine the connector runs on.',
    example: 'Home laptop connector',
    maxLength: API_TOKEN_NAME_MAX_LENGTH,
  })
  @IsString()
  @Length(1, API_TOKEN_NAME_MAX_LENGTH)
  name!: string;

  @ApiPropertyOptional({
    isArray: true,
    enum: [...API_TOKEN_SCOPES],
    description: "Defaults to ['accounts:import'] when omitted.",
  })
  @IsOptional()
  @ArrayMinSize(1)
  @ArrayMaxSize(API_TOKEN_SCOPES.length)
  @IsIn([...API_TOKEN_SCOPES], { each: true })
  scopes?: ApiTokenScope[];

  @ApiPropertyOptional({
    description:
      'ISO 8601 instant after which the token stops working, and it must be in the future ' +
      '(a past value is refused with API_TOKEN_EXPIRY_INVALID). Omit for no expiry.',
    example: '2027-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}
