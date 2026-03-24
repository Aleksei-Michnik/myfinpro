import { ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AUTH_ERRORS } from '../constants/auth-errors';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  private readonly logger = new Logger(GoogleAuthGuard.name);

  handleRequest<TUser>(err: Error | null, user: TUser, info: Error | undefined): TUser {
    if (err) {
      // Diagnostic: log the full error to identify the root cause (e.g. missing session for state: true)
      this.logger.error(
        `Google OAuth error [diagnostic]: message="${err.message}", ` +
          `name="${err.name}", stack="${err.stack}"`,
      );
      this.logger.error(
        `Google OAuth error [diagnostic]: Is this a session error? ` +
          `Contains "session": ${String(err.message).includes('session')}`,
      );
      throw new UnauthorizedException({
        message: 'Google authentication failed',
        errorCode: AUTH_ERRORS.OAUTH_PROVIDER_ERROR,
      });
    }

    if (!user) {
      const reason = info?.message || 'No user returned from Google';
      this.logger.warn(`Google OAuth failed [diagnostic]: reason="${reason}", info=${JSON.stringify(info)}`);
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
