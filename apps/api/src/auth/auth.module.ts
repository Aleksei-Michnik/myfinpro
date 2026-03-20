import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './services/password.service';
import { RefreshTokenService } from './services/refresh-token.service';
import { TokenService } from './services/token.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LocalStrategy } from './strategies/local.strategy';

@Module({
  imports: [
    PrismaModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService): JwtModuleOptions => {
        const secret = configService.get<string>('JWT_SECRET');
        const nodeEnv = configService.get<string>('NODE_ENV', 'development');
        if (!secret && nodeEnv !== 'development' && nodeEnv !== 'test') {
          throw new Error('JWT_SECRET environment variable is required in staging/production');
        }
        if (!secret) {
          // Only reachable in development/test — never in deployed environments
          const fallback = 'dev-only-jwt-secret-DO-NOT-USE-IN-PRODUCTION';
          return {
            secret: fallback,
            signOptions: { expiresIn: configService.get('JWT_EXPIRATION', '15m') },
          };
        }
        return {
          secret,
          signOptions: { expiresIn: configService.get('JWT_EXPIRATION', '15m') },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    RefreshTokenService,
    LocalStrategy,
    JwtStrategy,
  ],
  exports: [AuthService, PasswordService, TokenService, RefreshTokenService],
})
export class AuthModule {}
