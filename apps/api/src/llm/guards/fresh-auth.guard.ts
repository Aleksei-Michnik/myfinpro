import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { LLM_ERRORS } from '../constants/llm-errors';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';

/** Access tokens older than this cannot mutate stored API keys. */
export const FRESH_AUTH_MAX_AGE_SECONDS = 600;

/**
 * Phase 8.11 — step-up check for credential writes (runbook §9.4 layer 6):
 * the bearer token must have been issued within the last 10 minutes. The web
 * app silently refreshes on 401, so for a live session this is invisible;
 * a stolen long-idle token can't quietly swap a user's API key. Apply after
 * JwtAuthGuard (needs `req.user`).
 */
@Injectable()
export class FreshAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const issuedAt = (request.user as JwtPayload | undefined)?.iat;
    if (!issuedAt || Date.now() / 1000 - issuedAt > FRESH_AUTH_MAX_AGE_SECONDS) {
      throw new UnauthorizedException({
        message: 'Please sign in again to manage API keys',
        errorCode: LLM_ERRORS.LLM_REAUTH_REQUIRED,
      });
    }
    return true;
  }
}
