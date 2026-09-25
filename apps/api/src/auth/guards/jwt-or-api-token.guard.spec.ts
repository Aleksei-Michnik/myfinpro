import { API_TOKEN_PREFIX, API_TOKEN_SCOPE_ACCOUNTS_IMPORT } from '@myfinpro/shared';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AUTH_ERRORS } from '../constants/auth-errors';
import { ApiTokenService } from '../services/api-token.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtOrApiTokenGuard } from './jwt-or-api-token.guard';

/**
 * Phase 20 · 20.7 — the guard on `POST /accounts/:id/imports` (design §6.4).
 * A JWT works as everywhere else; a personal access token works only with
 * the `accounts:import` scope; anything else is rejected before the handler.
 */
describe('JwtOrApiTokenGuard', () => {
  const rawToken = `${API_TOKEN_PREFIX}abcdefghijklmnopqrstuvwxyz0123456789ABCD`;

  const apiTokenService = { verify: jest.fn() } as unknown as jest.Mocked<ApiTokenService>;
  let guard: JwtOrApiTokenGuard;
  let jwtCanActivate: jest.SpyInstance;

  const contextFor = (authorization?: string) => {
    const request: { headers: Record<string, string>; user?: unknown } = {
      headers: authorization ? { authorization } : {},
    };
    return {
      request,
      context: {
        switchToHttp: () => ({ getRequest: () => request }),
      } as unknown as ExecutionContext,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new JwtOrApiTokenGuard(apiTokenService);
    // The inherited passport path — exercised as a collaborator, not re-tested.
    jwtCanActivate = jest
      .spyOn(JwtAuthGuard.prototype, 'canActivate')
      .mockRejectedValue(new UnauthorizedException());
  });

  afterEach(() => jwtCanActivate.mockRestore());

  it('lets a valid JWT through without touching the token table', async () => {
    jwtCanActivate.mockResolvedValue(true);
    const { context } = contextFor('Bearer a.jwt.value');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(apiTokenService.verify).not.toHaveBeenCalled();
  });

  it('accepts a token carrying the accounts:import scope', async () => {
    apiTokenService.verify.mockResolvedValue({
      tokenId: 'token-1',
      userId: 'user-1',
      scopes: [API_TOKEN_SCOPE_ACCOUNTS_IMPORT],
      email: 'connector@test.local',
      name: 'Connector',
    });
    const { context, request } = contextFor(`Bearer ${rawToken}`);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({
      sub: 'user-1',
      email: 'connector@test.local',
      name: 'Connector',
      tokenId: 'token-1',
    });
  });

  it('403s a token without the scope', async () => {
    apiTokenService.verify.mockResolvedValue({
      tokenId: 'token-1',
      userId: 'user-1',
      scopes: [],
      email: 'connector@test.local',
      name: 'Connector',
    });
    const { context, request } = contextFor(`Bearer ${rawToken}`);

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: { errorCode: AUTH_ERRORS.API_TOKEN_SCOPE },
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    expect(request.user).toBeUndefined();
  });

  it('401s a revoked, expired or unknown token', async () => {
    apiTokenService.verify.mockResolvedValue(null);
    const { context } = contextFor(`Bearer ${rawToken}`);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('401s a missing Authorization header', async () => {
    const { context } = contextFor();

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(apiTokenService.verify).not.toHaveBeenCalled();
  });

  it('401s a bearer that is neither a valid JWT nor one of our tokens', async () => {
    const { context } = contextFor('Bearer not-a-token');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(apiTokenService.verify).not.toHaveBeenCalled();
  });
});
