// Phase 6 · Iteration 6.18.1.4 — RealtimeModule wiring.

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { EventBus } from './event-bus.service';
import { EventsController } from './events.controller';
import { RealtimeAuthGuard } from './realtime-auth.guard';

@Module({
  imports: [
    ConfigModule,
    // Mirror AuthModule's JWT setup so this module can verify access tokens
    // independently (the cookie path used by EventSource doesn't go through
    // Passport's JwtStrategy).
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
          secret: secret ?? 'dev-only-jwt-secret-DO-NOT-USE-IN-PRODUCTION',
          signOptions: { expiresIn: configService.get('JWT_EXPIRATION', '15m') },
        };
      },
    }),
  ],
  controllers: [EventsController],
  providers: [EventBus, RealtimeAuthGuard],
  exports: [EventBus, RealtimeAuthGuard],
})
export class RealtimeModule {}
