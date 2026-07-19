import { isLlmProvider, type LlmProvider } from '@myfinpro/shared';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CustomThrottle } from '../common/decorators/throttle.decorator';
import { LLM_ERRORS } from './constants/llm-errors';
import { SetLlmCredentialDto } from './dto/set-llm-credential.dto';
import { UpdateLlmSelectionDto } from './dto/update-llm-selection.dto';
import { FreshAuthGuard } from './guards/fresh-auth.guard';
import { LlmCredentialsService } from './llm-credentials.service';
import { LlmSettingsService } from './llm-settings.service';

/**
 * Phase 8.11 — per-user LLM settings (runbook §9).
 *
 * Credential routes are write-only with respect to key material: PUT accepts
 * a key, GET returns `{ provider, keyHint }` rows, and nothing ever returns
 * a stored key (§9.4 layer 2). Writes additionally require a freshly issued
 * token (FreshAuthGuard) and are throttled hard — an attacker with a hijacked
 * session should find this the least useful endpoint in the app.
 */
@ApiTags('llm')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('llm')
export class LlmController {
  constructor(
    private readonly settingsService: LlmSettingsService,
    private readonly credentialsService: LlmCredentialsService,
  ) {}

  @Get('catalog')
  @CustomThrottle({ limit: 30, ttl: 60000 })
  @ApiOperation({ summary: 'Model catalog with availability, current selection and key hints' })
  @ApiOkResponse({ description: 'Catalog, selection and hint-only credentials' })
  @ApiUnauthorizedResponse({ description: 'Not authenticated' })
  async getCatalog(@CurrentUser() user: JwtPayload) {
    return this.settingsService.getCatalog(user.sub);
  }

  @Put('selection')
  @CustomThrottle({ limit: 10, ttl: 60000 })
  @ApiOperation({ summary: 'Select the extraction model (both fields null = deployment default)' })
  @ApiOkResponse({ description: 'Updated selection' })
  @ApiUnauthorizedResponse({ description: 'Not authenticated' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  async updateSelection(@CurrentUser() user: JwtPayload, @Body() dto: UpdateLlmSelectionDto) {
    const selection = await this.settingsService.updateSelection(user.sub, dto.provider, dto.model);
    return { selection };
  }

  @Get('credentials')
  @CustomThrottle({ limit: 30, ttl: 60000 })
  @ApiOperation({ summary: 'List stored API keys as provider + last-4 hints' })
  @ApiOkResponse({ description: 'Hint-only credential rows' })
  @ApiUnauthorizedResponse({ description: 'Not authenticated' })
  async listCredentials(@CurrentUser() user: JwtPayload) {
    return { credentials: await this.credentialsService.listCredentials(user.sub) };
  }

  @Put('credentials/:provider')
  @UseGuards(FreshAuthGuard)
  @CustomThrottle({ limit: 5, ttl: 600000 })
  @ApiOperation({ summary: 'Store (or replace) an API key for a provider' })
  @ApiOkResponse({ description: 'Hint of the stored credential' })
  @ApiUnauthorizedResponse({ description: 'Not authenticated or session not fresh' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  async setCredential(
    @CurrentUser() user: JwtPayload,
    @Param('provider') provider: string,
    @Body() dto: SetLlmCredentialDto,
  ) {
    const credential = await this.credentialsService.setCredential(
      user.sub,
      this.parseProvider(provider),
      dto.apiKey,
    );
    return { credential };
  }

  @Delete('credentials/:provider')
  @UseGuards(FreshAuthGuard)
  @CustomThrottle({ limit: 5, ttl: 600000 })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete the stored API key for a provider' })
  @ApiNoContentResponse({ description: 'Credential deleted' })
  @ApiNotFoundResponse({ description: 'No credential stored for this provider' })
  @ApiUnauthorizedResponse({ description: 'Not authenticated or session not fresh' })
  async deleteCredential(@CurrentUser() user: JwtPayload, @Param('provider') provider: string) {
    await this.credentialsService.deleteCredential(user.sub, this.parseProvider(provider));
  }

  private parseProvider(value: string): LlmProvider {
    if (!isLlmProvider(value)) {
      throw new BadRequestException({
        message: `Unknown LLM provider '${value}'`,
        errorCode: LLM_ERRORS.LLM_INVALID_PROVIDER,
      });
    }
    return value;
  }
}
