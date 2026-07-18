import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CookieOrBearerAuthGuard } from './cookie-or-bearer-auth.guard';

interface MockRequest {
  cookies: Record<string, string>;
  headers: Record<string, string>;
  user?: unknown;
}

const ctxFor = (request: MockRequest): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
  }) as unknown as ExecutionContext;

describe('CookieOrBearerAuthGuard', () => {
  const validPayload = { sub: 'user-1', email: 'a@b', name: 'A' };
  let jwtService: JwtService;
  let guard: CookieOrBearerAuthGuard;

  beforeEach(() => {
    jwtService = {
      verifyAsync: jest.fn(async (token: string) => {
        if (token === 'good') return validPayload;
        throw new Error('invalid');
      }),
    } as unknown as JwtService;
    guard = new CookieOrBearerAuthGuard(jwtService);
  });

  it('passes when access_token cookie carries a valid JWT', async () => {
    const req: MockRequest = { cookies: { access_token: 'good' }, headers: {} };
    await expect(guard.canActivate(ctxFor(req))).resolves.toBe(true);
    expect(req.user).toEqual(validPayload);
  });

  it('falls back to Authorization: Bearer header', async () => {
    const req: MockRequest = { cookies: {}, headers: { authorization: 'Bearer good' } };
    await expect(guard.canActivate(ctxFor(req))).resolves.toBe(true);
    expect(req.user).toEqual(validPayload);
  });

  it('prefers cookie over header when both are present', async () => {
    const req: MockRequest = {
      cookies: { access_token: 'good' },
      headers: { authorization: 'Bearer bad' },
    };
    await expect(guard.canActivate(ctxFor(req))).resolves.toBe(true);
  });

  it('rejects when no token is provided', async () => {
    const req: MockRequest = { cookies: {}, headers: {} };
    await expect(guard.canActivate(ctxFor(req))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when the token is invalid', async () => {
    const req: MockRequest = { cookies: { access_token: 'bad' }, headers: {} };
    await expect(guard.canActivate(ctxFor(req))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
