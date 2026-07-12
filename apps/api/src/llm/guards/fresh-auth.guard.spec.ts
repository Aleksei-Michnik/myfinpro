import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { FRESH_AUTH_MAX_AGE_SECONDS, FreshAuthGuard } from './fresh-auth.guard';

describe('FreshAuthGuard', () => {
  const contextWith = (user: unknown): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  const guard = new FreshAuthGuard();
  const nowSeconds = () => Math.floor(Date.now() / 1000);

  it('passes a freshly issued token', () => {
    expect(guard.canActivate(contextWith({ sub: 'u1', iat: nowSeconds() - 30 }))).toBe(true);
  });

  it('rejects a token older than the freshness window', () => {
    expect(() =>
      guard.canActivate(
        contextWith({ sub: 'u1', iat: nowSeconds() - FRESH_AUTH_MAX_AGE_SECONDS - 60 }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('rejects when iat is absent', () => {
    expect(() => guard.canActivate(contextWith({ sub: 'u1' }))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(contextWith(undefined))).toThrow(UnauthorizedException);
  });
});
