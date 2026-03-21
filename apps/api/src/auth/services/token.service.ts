import { createHash, randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Response } from 'express';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  generateAccessToken(user: { id: string; email: string; name: string }): string {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      name: user.name,
    };
    return this.jwtService.sign(payload);
  }

  generateRefreshToken(): string {
    return randomUUID();
  }

  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  setRefreshTokenCookie(response: Response, token: string): void {
    const maxAge = this.getRefreshExpirationMs();
    const secure = this.configService.get<string>('NODE_ENV') !== 'development';

    // Clear legacy cookie path first — before the cookie-path fix,
    // cookies were set with path '/api/v1/auth'. Browsers with both
    // the old (more-specific) and new cookie send the old one first,
    // triggering token-reuse detection. Clearing it ensures only the
    // correct cookie is sent on subsequent requests.
    this.clearLegacyCookie(response, secure);

    response.cookie('refresh_token', token, {
      httpOnly: true,
      secure,
      sameSite: 'strict',
      path: '/api',
      maxAge,
    });
  }

  clearRefreshTokenCookie(response: Response): void {
    const secure = this.configService.get<string>('NODE_ENV') !== 'development';

    // Clear both legacy and current cookie paths
    this.clearLegacyCookie(response, secure);

    response.clearCookie('refresh_token', {
      httpOnly: true,
      secure,
      sameSite: 'strict',
      path: '/api',
    });
  }

  /**
   * Remove the refresh_token cookie that was set with the old
   * path '/api/v1/auth' (before the cookie-path fix).
   * Safe to call even when the legacy cookie doesn't exist.
   */
  private clearLegacyCookie(response: Response, secure: boolean): void {
    response.clearCookie('refresh_token', {
      httpOnly: true,
      secure,
      sameSite: 'strict',
      path: '/api/v1/auth',
    });
  }

  getRefreshExpirationMs(): number {
    const expiration = this.configService.get<string>('JWT_REFRESH_EXPIRATION', '7d');
    // Parse "7d" format
    const match = expiration.match(/^(\d+)([smhd])$/);
    if (!match) return 7 * 24 * 60 * 60 * 1000; // default 7 days
    const value = parseInt(match[1], 10);
    const unit = match[2];
    switch (unit) {
      case 's':
        return value * 1000;
      case 'm':
        return value * 60 * 1000;
      case 'h':
        return value * 60 * 60 * 1000;
      case 'd':
        return value * 24 * 60 * 60 * 1000;
      default:
        return 7 * 24 * 60 * 60 * 1000;
    }
  }

  getRefreshExpirationDate(): Date {
    return new Date(Date.now() + this.getRefreshExpirationMs());
  }
}
