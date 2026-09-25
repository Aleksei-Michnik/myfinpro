// Phase 20 · Iteration 20.7 — the one guard that accepts a personal access
// token (design §6.4).
//
// Used on `POST /accounts/:accountId/imports` and nowhere else: the connector
// runs on the user's own machine, holds the bank credentials there, and needs
// exactly one capability — pushing normalised statement lines. Every other
// route stays Bearer-JWT only, so a leaked token cannot read transactions,
// mint further tokens or change anything.

import {
  API_TOKEN_PREFIX,
  API_TOKEN_SCOPE_ACCOUNTS_IMPORT,
  type ApiTokenScope,
} from '@myfinpro/shared';
import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AUTH_ERRORS } from '../constants/auth-errors';
import type { JwtPayload } from '../interfaces/jwt-payload.interface';
import { ApiTokenService } from '../services/api-token.service';
import { JwtAuthGuard } from './jwt-auth.guard';

/** What `request.user` holds when the caller authenticated with a token. */
export interface ApiTokenPrincipal extends JwtPayload {
  /** Id of the token used — never the token itself. Audit and logs use this. */
  tokenId: string;
}

/** The scope this route requires; the only scope v1 issues. */
const REQUIRED_SCOPE: ApiTokenScope = API_TOKEN_SCOPE_ACCOUNTS_IMPORT;

@Injectable()
export class JwtOrApiTokenGuard extends JwtAuthGuard {
  constructor(private readonly apiTokenService: ApiTokenService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // The browser path first — a JWT is what almost every caller presents.
    try {
      if (await super.canActivate(context)) return true;
    } catch {
      // Not a valid JWT; a personal access token may still be presented.
    }

    const request = context.switchToHttp().getRequest<Request>();
    const raw = extractBearer(request);
    if (!raw?.startsWith(API_TOKEN_PREFIX)) {
      throw new UnauthorizedException({
        message: 'Invalid or missing access token',
        errorCode: AUTH_ERRORS.TOKEN_INVALID,
      });
    }

    const verified = await this.apiTokenService.verify(raw);
    if (!verified) {
      throw new UnauthorizedException({
        message: 'Invalid, revoked or expired API token',
        errorCode: AUTH_ERRORS.TOKEN_INVALID,
      });
    }
    if (!verified.scopes.includes(REQUIRED_SCOPE)) {
      throw new ForbiddenException({
        message: `This token lacks the '${REQUIRED_SCOPE}' scope`,
        errorCode: AUTH_ERRORS.API_TOKEN_SCOPE,
      });
    }

    const principal: ApiTokenPrincipal = {
      sub: verified.userId,
      email: verified.email,
      name: verified.name,
      tokenId: verified.tokenId,
    };
    (request as Request & { user?: ApiTokenPrincipal }).user = principal;
    return true;
  }
}

function extractBearer(request: Request): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}
