import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiExcludeEndpoint,
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { CustomThrottle } from '../common/decorators/throttle.decorator';
import { AuthService, GoogleProfile, TelegramProfile } from './auth.service';
import { AUTH_ERRORS } from './constants/auth-errors';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthResponseDto } from './dto/auth-response.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { TelegramAuthDto } from './dto/telegram-auth.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { AccountDeletionService } from './services/account-deletion.service';
import { EmailVerificationService } from './services/email-verification.service';
import { PasswordResetService } from './services/password-reset.service';
import { TokenService } from './services/token.service';
import { verifyTelegramAuth } from './utils/telegram-auth.util';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
    private readonly accountDeletionService: AccountDeletionService,
    private readonly emailVerificationService: EmailVerificationService,
    private readonly passwordResetService: PasswordResetService,
    private readonly tokenService: TokenService,
  ) {}

  @CustomThrottle({ limit: 5, ttl: 60000 })
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user account' })
  @ApiResponse({
    status: 201,
    description: 'User registered successfully',
    type: AuthResponseDto,
  })
  @ApiConflictResponse({ description: 'Email already exists' })
  @ApiTooManyRequestsResponse({ description: 'Too many registration attempts' })
  async register(
    @Body() registerDto: RegisterDto,
    @Res({ passthrough: true }) response: Response,
    @Req() request: Request,
  ) {
    const ip = request.ip;
    const userAgent = request.headers['user-agent'];
    return this.authService.register(registerDto, response, ip, userAgent);
  }

  @CustomThrottle({ limit: 5, ttl: 60000 })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({
    status: 200,
    description: 'Login successful',
    type: AuthResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Invalid email or password' })
  @ApiTooManyRequestsResponse({ description: 'Too many login attempts' })
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) response: Response,
    @Req() request: Request,
  ) {
    const user = await this.authService.validateUser(loginDto.email, loginDto.password);
    if (!user) {
      throw new UnauthorizedException({
        message: 'Invalid email or password',
        errorCode: AUTH_ERRORS.INVALID_CREDENTIALS,
      });
    }
    const ip = request.ip;
    const userAgent = request.headers['user-agent'];
    return this.authService.login(user, response, ip, userAgent);
  }

  @CustomThrottle({ limit: 10, ttl: 60000 })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token using refresh token cookie' })
  @ApiResponse({
    status: 200,
    description: 'Tokens refreshed successfully',
  })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired refresh token' })
  async refresh(@Res({ passthrough: true }) response: Response, @Req() request: Request) {
    const refreshToken = request.cookies?.refresh_token;
    if (!refreshToken) {
      throw new UnauthorizedException({
        message: 'No refresh token provided',
        errorCode: AUTH_ERRORS.REFRESH_FAILED,
      });
    }

    const ip = request.ip;
    const userAgent = request.headers['user-agent'];
    return this.authService.refreshTokens(refreshToken, response, ip, userAgent);
  }

  @CustomThrottle({ limit: 10, ttl: 60000 })
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout and revoke refresh token' })
  @ApiResponse({
    status: 200,
    description: 'Logged out successfully',
  })
  async logout(@Res({ passthrough: true }) response: Response, @Req() request: Request) {
    const refreshToken = request.cookies?.refresh_token;

    if (refreshToken) {
      return this.authService.logout(refreshToken, response);
    }

    // Even without a cookie, clear it and return success
    return this.authService.logout('', response);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user profile' })
  @ApiResponse({
    status: 200,
    description: 'Current user data',
  })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  async getMe(@CurrentUser() user: JwtPayload) {
    return this.authService.getUser(user.sub);
  }

  @CustomThrottle({ limit: 10, ttl: 60000 })
  @UseGuards(JwtAuthGuard)
  @Patch('profile')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update user profile preferences (currency, timezone, locale)' })
  @ApiResponse({ status: 200, description: 'Profile updated successfully' })
  @ApiBadRequestResponse({ description: 'Invalid currency or timezone' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  async updateProfile(@CurrentUser() user: JwtPayload, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(user.sub, dto);
  }

  @CustomThrottle({ limit: 3, ttl: 600000 })
  @UseGuards(JwtAuthGuard)
  @Post('send-verification-email')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Send or resend email verification link' })
  @ApiResponse({
    status: 200,
    description: 'Verification email sent or already verified',
  })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiTooManyRequestsResponse({ description: 'Too many verification email requests' })
  async sendVerificationEmail(@CurrentUser() user: JwtPayload) {
    try {
      await this.emailVerificationService.resendVerification(user.sub);
      return { message: 'Verification email sent' };
    } catch (error) {
      // If already verified, return 200 with message
      if (
        error instanceof BadRequestException &&
        (error.getResponse() as Record<string, unknown>).errorCode ===
          AUTH_ERRORS.EMAIL_ALREADY_VERIFIED
      ) {
        return { message: 'Email already verified' };
      }
      throw error;
    }
  }

  @CustomThrottle({ limit: 5, ttl: 600000 })
  @Get('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify email address using token from email link' })
  @ApiQuery({ name: 'token', required: true, description: 'Verification token from email' })
  @ApiResponse({
    status: 200,
    description: 'Email verified successfully',
  })
  @ApiUnauthorizedResponse({ description: 'Invalid verification token' })
  @ApiBadRequestResponse({ description: 'Token expired or already used' })
  @ApiTooManyRequestsResponse({ description: 'Too many verification attempts' })
  async verifyEmail(@Query('token') token: string) {
    if (!token) {
      throw new BadRequestException({
        message: 'Verification token is required',
        errorCode: AUTH_ERRORS.VERIFICATION_TOKEN_INVALID,
      });
    }

    await this.emailVerificationService.verifyEmail(token);
    return { message: 'Email verified successfully' };
  }

  @CustomThrottle({ limit: 3, ttl: 600000 })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a password reset email' })
  @ApiResponse({
    status: 200,
    description: 'If an account with this email exists, a reset link has been sent.',
  })
  @ApiTooManyRequestsResponse({ description: 'Too many password reset requests' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.passwordResetService.forgotPassword(dto.email);
    return {
      message: 'If an account with this email exists, a reset link has been sent.',
    };
  }

  @CustomThrottle({ limit: 5, ttl: 600000 })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using token from email' })
  @ApiResponse({
    status: 200,
    description: 'Password reset successfully',
  })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired reset token' })
  @ApiBadRequestResponse({ description: 'Token already used or invalid password' })
  @ApiTooManyRequestsResponse({ description: 'Too many reset attempts' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.passwordResetService.resetPassword(dto.token, dto.password);
    return {
      message: 'Password reset successfully. Please sign in with your new password.',
    };
  }

  @CustomThrottle({ limit: 3, ttl: 600000 })
  @UseGuards(JwtAuthGuard)
  @Post('delete-account')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Request account deletion with 30-day grace period' })
  @ApiResponse({
    status: 200,
    description: 'Account scheduled for deletion',
  })
  @ApiBadRequestResponse({ description: 'Confirmation email mismatch or account already deleted' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiTooManyRequestsResponse({ description: 'Too many deletion requests' })
  async deleteAccount(
    @CurrentUser() user: JwtPayload,
    @Body() dto: DeleteAccountDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.accountDeletionService.requestDeletion(user.sub, dto.confirmation);
    this.tokenService.clearRefreshTokenCookie(response);
    return {
      message: 'Account scheduled for deletion',
      scheduledDeletionAt: result.scheduledDeletionAt,
    };
  }

  @CustomThrottle({ limit: 5, ttl: 600000 })
  @UseGuards(JwtAuthGuard)
  @Post('cancel-deletion')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel pending account deletion' })
  @ApiResponse({
    status: 200,
    description: 'Account deletion cancelled',
  })
  @ApiBadRequestResponse({ description: 'Account not deleted or grace period expired' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiTooManyRequestsResponse({ description: 'Too many cancellation requests' })
  async cancelDeletion(@CurrentUser() user: JwtPayload) {
    await this.accountDeletionService.cancelDeletion(user.sub);
    return { message: 'Account deletion cancelled' };
  }

  @CustomThrottle({ limit: 10, ttl: 60000 })
  @UseGuards(GoogleAuthGuard)
  @Get('google')
  @ApiExcludeEndpoint()
  async googleAuth() {
    // Guard redirects to Google — this method body is never executed
  }

  @CustomThrottle({ limit: 10, ttl: 60000 })
  @UseGuards(GoogleAuthGuard)
  @Get('google/callback')
  @ApiExcludeEndpoint()
  async googleCallback(@Req() request: Request, @Res() response: Response) {
    const googleProfile = request.user as GoogleProfile;
    const user = await this.authService.findOrCreateGoogleUser(googleProfile);

    // Use the existing login flow to generate tokens, set cookie, update lastLoginAt
    const ip = request.ip;
    const userAgent = request.headers['user-agent'];
    const { accessToken } = await this.authService.login(user, response, ip, userAgent);

    // Redirect to frontend with access token (derive from SERVER_NAME)
    const serverName = this.configService.get<string>('SERVER_NAME', '');
    const frontendUrl = serverName ? `https://${serverName}` : 'http://localhost:3000';
    const locale = user.locale || 'en';
    const redirectUrl = `${frontendUrl}/${locale}/auth/callback?token=${accessToken}`;

    this.logger.log(`Google OAuth callback: redirecting user ${user.id} to frontend`);
    response.redirect(redirectUrl);
  }

  @CustomThrottle({ limit: 5, ttl: 60000 })
  @Post('telegram/callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate via Telegram Login Widget (HMAC-SHA256)' })
  @ApiResponse({
    status: 200,
    description: 'Telegram authentication successful',
    type: AuthResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired Telegram auth data' })
  @ApiTooManyRequestsResponse({ description: 'Too many authentication attempts' })
  async telegramCallback(
    @Body() dto: TelegramAuthDto,
    @Res({ passthrough: true }) response: Response,
    @Req() request: Request,
  ) {
    const botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    if (!botToken) {
      throw new UnauthorizedException({
        message: 'Telegram authentication is not configured',
        errorCode: AUTH_ERRORS.OAUTH_PROVIDER_ERROR,
      });
    }

    // Verify HMAC-SHA256 hash using the bot token
    let authData;
    try {
      authData = verifyTelegramAuth(dto, botToken);
    } catch (error) {
      this.logger.warn(
        `Telegram auth verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new UnauthorizedException({
        message: 'Invalid Telegram authentication data',
        errorCode: AUTH_ERRORS.TELEGRAM_AUTH_INVALID,
      });
    }

    // Build profile from verified data and find or create user
    const telegramProfile: TelegramProfile = {
      telegramId: authData.telegramId,
      firstName: authData.firstName,
      lastName: authData.lastName,
      username: authData.username,
      photoUrl: authData.photoUrl,
    };

    const user = await this.authService.findOrCreateTelegramUser(telegramProfile);

    const ip = request.ip;
    const userAgent = request.headers['user-agent'];
    return this.authService.login(user, response, ip, userAgent);
  }

  @UseGuards(JwtAuthGuard)
  @Get('connected-accounts')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List connected authentication providers' })
  @ApiResponse({
    status: 200,
    description: 'Connected accounts list with hasPassword flag',
  })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  async getConnectedAccounts(@CurrentUser() user: JwtPayload) {
    return this.authService.getConnectedAccounts(user.sub);
  }

  @CustomThrottle({ limit: 5, ttl: 60000 })
  @UseGuards(JwtAuthGuard)
  @Post('link/telegram')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Link a Telegram account to the authenticated user' })
  @ApiResponse({
    status: 200,
    description: 'Telegram account linked successfully',
  })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiConflictResponse({ description: 'Telegram account already linked to another user' })
  @ApiTooManyRequestsResponse({ description: 'Too many link attempts' })
  async linkTelegram(@CurrentUser() user: JwtPayload, @Body() dto: TelegramAuthDto) {
    const botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    if (!botToken) {
      throw new UnauthorizedException({
        message: 'Telegram authentication is not configured',
        errorCode: AUTH_ERRORS.OAUTH_PROVIDER_ERROR,
      });
    }

    // Verify HMAC-SHA256 hash using the bot token
    try {
      verifyTelegramAuth(dto, botToken);
    } catch (error) {
      this.logger.warn(
        `Telegram link verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new UnauthorizedException({
        message: 'Invalid Telegram authentication data',
        errorCode: AUTH_ERRORS.TELEGRAM_AUTH_INVALID,
      });
    }

    return this.authService.linkTelegramToUser(user.sub, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('connected-accounts/:provider')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Unlink an authentication provider from the authenticated user' })
  @ApiParam({ name: 'provider', enum: ['google', 'telegram'] })
  @ApiResponse({
    status: 200,
    description: 'Provider unlinked successfully',
  })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiNotFoundResponse({ description: 'Provider not linked' })
  @ApiBadRequestResponse({ description: 'Cannot unlink the last authentication method' })
  async unlinkProvider(@CurrentUser() user: JwtPayload, @Param('provider') provider: string) {
    // Validate provider parameter
    const validProviders = ['google', 'telegram'];
    if (!validProviders.includes(provider)) {
      throw new BadRequestException({
        message: `Invalid provider: ${provider}. Must be one of: ${validProviders.join(', ')}`,
        errorCode: AUTH_ERRORS.PROVIDER_NOT_FOUND,
      });
    }

    return this.authService.unlinkProvider(user.sub, provider);
  }
}
