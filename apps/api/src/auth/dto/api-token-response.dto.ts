import { API_TOKEN_SCOPES, type ApiTokenScope } from '@myfinpro/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** A token as listed in settings — the secret is never part of this shape. */
export class ApiTokenResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ isArray: true, enum: [...API_TOKEN_SCOPES] }) scopes!: ApiTokenScope[];
  @ApiPropertyOptional({ nullable: true, description: 'Null until the token is first used.' })
  lastUsedAt!: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'Null for a token that does not expire.' })
  expiresAt!: string | null;
  @ApiProperty() createdAt!: string;
}

/**
 * POST /auth/tokens response — the only place the raw token exists outside
 * the caller's own storage. Only its SHA-256 hash is kept server-side, so a
 * lost token is replaced, never recovered.
 */
export class ApiTokenCreatedResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ isArray: true, enum: [...API_TOKEN_SCOPES] }) scopes!: ApiTokenScope[];
  @ApiProperty({
    description: 'Shown exactly once. Store it now — it cannot be read back.',
    example: 'mfp_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  })
  token!: string;
  @ApiProperty() createdAt!: string;
  @ApiPropertyOptional({ nullable: true }) expiresAt!: string | null;
}
