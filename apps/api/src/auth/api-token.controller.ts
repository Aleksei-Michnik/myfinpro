import { API_TOKEN_MAX_ACTIVE } from '@myfinpro/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CustomThrottle } from '../common/decorators/throttle.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { ApiTokenCreatedResponseDto, ApiTokenResponseDto } from './dto/api-token-response.dto';
import { CreateApiTokenDto } from './dto/create-api-token.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { JwtPayload } from './interfaces/jwt-payload.interface';
import { ApiTokenService } from './services/api-token.service';

/**
 * Phase 20 · Iteration 20.7 — `/auth/tokens` (design §6.4).
 *
 * Personal access tokens for the user-run import connector. Managing them is
 * a JWT-only surface: an API token can never mint, list or revoke tokens —
 * it is accepted by exactly one route (`POST /accounts/:id/imports`).
 */
@ApiTags('Authentication')
@Controller('auth/tokens')
export class ApiTokenController {
  constructor(private readonly service: ApiTokenService) {}

  @CustomThrottle({ limit: 30, ttl: 60000 })
  @UseGuards(JwtAuthGuard)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a scoped personal access token',
    description:
      'The raw token is returned once and only once — only its SHA-256 hash is stored. ' +
      "Scopes default to ['accounts:import'], the single scope v1 knows, which is accepted " +
      'by the statement-import route alone.',
  })
  @ApiBody({ type: CreateApiTokenDto })
  @ApiCreatedResponse({ description: 'The token, shown once', type: ApiTokenCreatedResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiConflictResponse({
    description: `API_TOKEN_LIMIT_REACHED — at most ${API_TOKEN_MAX_ACTIVE} active tokens per user`,
  })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (30/min)' })
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateApiTokenDto,
  ): Promise<ApiTokenCreatedResponseDto> {
    return this.service.create(user.sub, dto);
  }

  @CustomThrottle({ limit: 120, ttl: 60000 })
  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiBearerAuth()
  @ApiOperation({
    summary: "List the caller's live tokens (newest first)",
    description: 'Metadata only — a token value is never readable after creation.',
  })
  @ApiOkResponse({ description: 'Tokens without secrets', type: [ApiTokenResponseDto] })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (120/min)' })
  async list(@CurrentUser() user: JwtPayload): Promise<ApiTokenResponseDto[]> {
    return this.service.list(user.sub);
  }

  @CustomThrottle({ limit: 30, ttl: 60000 })
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Revoke a token',
    description: 'Takes effect immediately. Another user’s token id is a 404, never a 403.',
  })
  @ApiNoContentResponse({ description: 'Token revoked' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiNotFoundResponse({
    description: 'API_TOKEN_NOT_FOUND — unknown, revoked, or not the caller’s',
  })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (30/min)' })
  async revoke(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.service.revoke(user.sub, id);
  }
}
