import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiConflictResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthResponseDto } from './dto/auth-response.dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user account' })
  @ApiResponse({
    status: 201,
    description: 'User registered successfully',
    type: AuthResponseDto,
  })
  @ApiConflictResponse({ description: 'Email already exists' })
  async register(
    @Body() registerDto: RegisterDto,
    @Res({ passthrough: true }) response: Response,
    @Req() request: Request,
  ) {
    const ip = request.ip;
    const userAgent = request.headers['user-agent'];
    return this.authService.register(registerDto, response, ip, userAgent);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({
    status: 200,
    description: 'Login successful',
    type: AuthResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Invalid email or password' })
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) response: Response,
    @Req() request: Request,
  ) {
    const user = await this.authService.validateUser(loginDto.email, loginDto.password);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const ip = request.ip;
    const userAgent = request.headers['user-agent'];
    return this.authService.login(user, response, ip, userAgent);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token using refresh token cookie' })
  @ApiResponse({
    status: 200,
    description: 'Tokens refreshed successfully',
  })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired refresh token' })
  async refresh(
    @Res({ passthrough: true }) response: Response,
    @Req() request: Request,
  ) {
    const refreshToken = request.cookies?.refresh_token;
    if (!refreshToken) {
      throw new UnauthorizedException('No refresh token provided');
    }

    const ip = request.ip;
    const userAgent = request.headers['user-agent'];
    return this.authService.refreshTokens(refreshToken, response, ip, userAgent);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout and revoke refresh token' })
  @ApiResponse({
    status: 200,
    description: 'Logged out successfully',
  })
  async logout(
    @Res({ passthrough: true }) response: Response,
    @Req() request: Request,
  ) {
    const refreshToken = request.cookies?.refresh_token;

    if (refreshToken) {
      return this.authService.logout(refreshToken, response);
    }

    // Even without a cookie, clear it and return success
    return this.authService.logout('', response);
  }
}
