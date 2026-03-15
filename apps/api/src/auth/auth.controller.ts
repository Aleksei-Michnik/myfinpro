import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiUnauthorizedResponse,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { CustomThrottle } from '../common/decorators/throttle.decorator';
import { AuthService } from './auth.service';
import { AUTH_ERRORS } from './constants/auth-errors';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthResponseDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtPayload } from './interfaces/jwt-payload.interface';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
}
