import { ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AUTH_ERRORS } from '../constants/auth-errors';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  private readonly logger = new Logger(GoogleAuthGuard.name);

  handleRequest<TUser>(err: Error | null, user: TUser, info: Error | undefined): TUser {
    if (err) {
      this.logger.error(`Google OAuth error: ${err.message}`, err.stack);
      throw new UnauthorizedException({
        message: 'Google authentication failed',
        errorCode: AUTH_ERRORS.OAUTH_PROVIDER_ERROR,
      });
    }

    if (!user) {
      const reason = info?.message || 'No user returned from Google';
      this.logger.warn(`Google OAuth failed: ${reason}`);
      throw new UnauthorizedException({
        message: 'Google authentication failed',
        errorCode: AUTH_ERRORS.OAUTH_PROVIDER_ERROR,
      });
    }

    return user;
  }

  getAuthenticateOptions(context: ExecutionContext) {
    // Suppress unused parameter warning
    void context;
    return { scope: ['email', 'profile'] };
  }
}
