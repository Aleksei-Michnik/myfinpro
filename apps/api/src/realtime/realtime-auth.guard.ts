// Phase 6 · Iteration 6.18.1.4 — SSE auth guard.
//
// EventSource cannot send `Authorization` headers, so we accept the JWT
// from the `access_token` cookie set alongside the existing Bearer flow
// (see [`apps/api/src/auth/utils/auth-cookie.ts`](../auth/utils/auth-cookie.ts)).
// The header is still consulted as a fallback for tooling (curl smoke
// tests, future non-browser clients).

import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@Injectable()
export class RealtimeAuthGuard implements CanActivate {
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
