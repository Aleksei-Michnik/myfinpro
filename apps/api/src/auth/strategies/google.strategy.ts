import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(configService: ConfigService) {
    const clientID = configService.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = configService.get<string>('GOOGLE_CLIENT_SECRET');
    const callbackURL = configService.get<string>(
      'GOOGLE_CALLBACK_URL',
      'http://localhost/api/v1/auth/google/callback',
    );

    const logger = new Logger(GoogleStrategy.name);

    if (!clientID || !clientSecret) {
      logger.warn(
        'GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set — Google OAuth will not work. ' +
          'Using dummy values to prevent app crash.',
      );
    }

    // Diagnostic: log credential status and callbackURL at bootstrap
    logger.log(
      `GoogleStrategy init: clientID=${clientID ? 'SET' : 'MISSING'}, ` +
        `clientSecret=${clientSecret ? 'SET' : 'MISSING'}, ` +
        `callbackURL=${callbackURL}, state=true`,
    );

    super({
      clientID: clientID || 'dummy-client-id',
      clientSecret: clientSecret || 'dummy-client-secret',
      callbackURL,
      scope: ['email', 'profile'],
      state: true,
    });

    // Diagnostic: warn about state: true requiring session middleware
    logger.warn(
      'state: true is configured — this requires express-session middleware on req.session. ' +
        'If sessions are not configured, Passport will throw: ' +
        '"OAuth2Strategy requires session support when using state."',
    );
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: {
      id: string;
      displayName: string;
      emails?: Array<{ value: string; verified?: boolean }>;
      photos?: Array<{ value: string }>;
    },
    done: VerifyCallback,
  ): Promise<void> {
    const email = profile.emails?.[0]?.value;
    const emailVerified = profile.emails?.[0]?.verified ?? false;
    const picture = profile.photos?.[0]?.value;

    const googleProfile = {
      googleId: profile.id,
      email,
      name: profile.displayName,
      picture,
      emailVerified,
    };

    done(null, googleProfile);
  }
}
