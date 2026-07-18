// 8.25-hotfix — THE JwtModule registration (previously duplicated verbatim
// in AuthModule and RealtimeModule, against the DRY rule).
//
// Import this module wherever access-token JWTs are signed or verified:
// AuthModule (token issuing), and every module whose controllers use
// `CookieOrBearerAuthGuard` — @UseGuards instantiates the guard inside the
// controller's host module, so that module itself must be able to resolve
// JwtService.

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService): JwtModuleOptions => {
        const secret = configService.get<string>('JWT_SECRET');
        const nodeEnv = configService.get<string>('NODE_ENV', 'development');
        if (!secret && nodeEnv !== 'development' && nodeEnv !== 'test') {
          throw new Error('JWT_SECRET environment variable is required in staging/production');
        }
        return {
          // The fallback is only reachable in development/test — never in
          // deployed environments (guarded above).
          secret: secret ?? 'dev-only-jwt-secret-DO-NOT-USE-IN-PRODUCTION',
          signOptions: { expiresIn: configService.get('JWT_EXPIRATION', '15m') },
        };
      },
    }),
  ],
  exports: [JwtModule],
})
export class JwtConfigModule {}
