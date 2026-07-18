import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtConfigModule } from './jwt-config.module';
import { AccountCleanupService } from './services/account-cleanup.service';
import { AccountDeletionService } from './services/account-deletion.service';
import { AccountMergeService } from './services/account-merge.service';
import { EmailVerificationService } from './services/email-verification.service';
import { OAuthService } from './services/oauth.service';
import { PasswordResetService } from './services/password-reset.service';
import { PasswordService } from './services/password.service';
import { RefreshTokenService } from './services/refresh-token.service';
import { TokenService } from './services/token.service';
import { GoogleStrategy } from './strategies/google.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LocalStrategy } from './strategies/local.strategy';

@Module({
  imports: [PrismaModule, PassportModule, JwtConfigModule],
  controllers: [AuthController],
  providers: [
    AccountCleanupService,
    AccountDeletionService,
    AccountMergeService,
    AuthService,
    EmailVerificationService,
    OAuthService,
    PasswordResetService,
    PasswordService,
    TokenService,
    RefreshTokenService,
    LocalStrategy,
    JwtStrategy,
    GoogleStrategy,
  ],
  exports: [
    AccountDeletionService,
    AuthService,
    EmailVerificationService,
    OAuthService,
    PasswordResetService,
    PasswordService,
    TokenService,
    RefreshTokenService,
  ],
})
export class AuthModule {}
