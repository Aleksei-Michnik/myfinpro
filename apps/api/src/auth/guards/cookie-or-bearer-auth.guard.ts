// Phase 6 · 6.18.1.4 (as RealtimeAuthGuard) → generalized in 8.25-hotfix.
//
// Auth for endpoints the browser hits WITHOUT an `Authorization` header:
// EventSource (SSE stream) and plain `<img>` tags (product pictures) can
// only ride the `access_token` cookie set alongside the Bearer flow (see
// [`../utils/auth-cookie.ts`](../utils/auth-cookie.ts)). The header is
// still consulted as a fallback for tooling (curl smoke tests, future
// non-browser clients). Read-only/GET surfaces only — mutations stay on
// the Bearer-only JwtAuthGuard.
//
// @UseGuards instantiates this class inside the controller's host module,
// so every consuming module must import JwtConfigModule to make the
// injected JwtService resolvable there.

import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import type { JwtPayload } from '../interfaces/jwt-payload.interface';

@Injectable()
export class CookieOrBearerAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing access token');
    }
    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      // Mirror passport's behaviour — attach to request.user.
      (request as Request & { user?: JwtPayload }).user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }

  private extractToken(request: Request): string | null {
    const cookieToken = request.cookies?.access_token;
    if (typeof cookieToken === 'string' && cookieToken.length > 0) {
      return cookieToken;
    }
    const header = request.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      return header.slice('Bearer '.length).trim() || null;
    }
    return null;
  }
}
