import { randomBytes } from 'crypto';
import {
  API_TOKEN_MAX_ACTIVE,
  API_TOKEN_PREFIX,
  API_TOKEN_SCOPES,
  API_TOKEN_SCOPE_ACCOUNTS_IMPORT,
  type ApiTokenCreated,
  type ApiTokenScope,
  type ApiTokenSummary,
} from '@myfinpro/shared';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AUTH_ERRORS } from '../constants/auth-errors';
import { CreateApiTokenDto } from '../dto/create-api-token.dto';
import { TokenService } from './token.service';

/** What the guard learns from a valid token — never the token itself. */
export interface VerifiedApiToken {
  tokenId: string;
  userId: string;
  scopes: ApiTokenScope[];
  /** Identity fields, so the guard can build the `JwtPayload` shape controllers expect. */
  email: string;
  name: string;
}

/** Random bytes behind the prefix: 30 bytes → exactly 40 base64url characters. */
const TOKEN_RANDOM_BYTES = 30;

/** `lastUsedAt` is a rough "still in use" signal, not an access log. */
const LAST_USED_THROTTLE_MS = 60_000;

/**
 * Phase 20 · Iteration 20.7 — scoped personal access tokens (design §6.4).
 *
 * The user-run connector holds bank credentials on the user's own machine and
 * pushes only normalised lines; this token is what authenticates that push.
 * It is stored exactly like a refresh token — SHA-256 through
 * `TokenService.hashToken`, never in the clear — returned once at creation,
 * and never logged: ids only, here and in the audit trail.
 */
@Injectable()
export class ApiTokenService {
  private readonly logger = new Logger(ApiTokenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
  ) {}

  /** Mint a token. The raw value exists only in the response — never again. */
  async create(userId: string, dto: CreateApiTokenDto): Promise<ApiTokenCreated> {
    // A token that is already expired is a dead token the user would have to
    // debug at the connector; refuse it here instead of shipping the secret.
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (expiresAt && expiresAt <= new Date()) {
      throw new BadRequestException({
        message: 'expiresAt must be in the future',
        errorCode: AUTH_ERRORS.API_TOKEN_EXPIRY_INVALID,
      });
    }

    const activeCount = await this.prisma.apiToken.count({
      where: {
        userId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    if (activeCount >= API_TOKEN_MAX_ACTIVE) {
      throw new ConflictException({
        message: `At most ${API_TOKEN_MAX_ACTIVE} active tokens — revoke one first`,
        errorCode: AUTH_ERRORS.API_TOKEN_LIMIT_REACHED,
      });
    }

    const scopes: ApiTokenScope[] = dto.scopes?.length
      ? [...new Set(dto.scopes)]
      : [API_TOKEN_SCOPE_ACCOUNTS_IMPORT];
    const raw = `${API_TOKEN_PREFIX}${randomBytes(TOKEN_RANDOM_BYTES).toString('base64url')}`;

    const token = await this.prisma.apiToken.create({
      data: {
        tokenHash: this.tokenService.hashToken(raw),
        userId,
        name: dto.name,
        scopes: scopes.join(','),
        expiresAt,
      },
    });
    await this.writeAudit(userId, 'API_TOKEN_CREATED', token.id, {
      scopes,
      expiresAt: token.expiresAt?.toISOString() ?? null,
    });

    return {
      id: token.id,
      name: token.name,
      scopes,
      token: raw,
      createdAt: token.createdAt.toISOString(),
      expiresAt: token.expiresAt?.toISOString() ?? null,
    };
  }

  /** The caller's live tokens, newest first. Secrets are not listable. */
  async list(userId: string): Promise<ApiTokenSummary[]> {
    const tokens = await this.prisma.apiToken.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        scopes: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
      },
    });
    return tokens.map((token) => ({
      id: token.id,
      name: token.name,
      scopes: parseScopes(token.scopes),
      lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
      expiresAt: token.expiresAt?.toISOString() ?? null,
      createdAt: token.createdAt.toISOString(),
    }));
  }

  /** Revoke one of the caller's tokens. Another user's id is a 404, not a 403. */
  async revoke(userId: string, tokenId: string): Promise<void> {
    const { count } = await this.prisma.apiToken.updateMany({
      where: { id: tokenId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) {
      throw new NotFoundException({
        message: 'Token not found',
        errorCode: AUTH_ERRORS.API_TOKEN_NOT_FOUND,
      });
    }
    await this.writeAudit(userId, 'API_TOKEN_REVOKED', tokenId, {});
  }

  /**
   * Resolve a raw bearer value to its owner and scopes, or null when it is
   * not a token of ours, revoked, expired, or belongs to a disabled account.
   * Bumps `lastUsedAt` at most once a minute, best effort.
   */
  async verify(raw: string): Promise<VerifiedApiToken | null> {
    if (!raw.startsWith(API_TOKEN_PREFIX)) return null;

    const token = await this.prisma.apiToken.findUnique({
      where: { tokenHash: this.tokenService.hashToken(raw) },
      select: {
        id: true,
        userId: true,
        scopes: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        user: { select: { email: true, name: true, isActive: true } },
      },
    });
    if (!token || token.revokedAt || !token.user?.isActive) return null;
    const now = new Date();
    if (token.expiresAt && token.expiresAt <= now) return null;

    if (!token.lastUsedAt || now.getTime() - token.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
      try {
        await this.prisma.apiToken.update({ where: { id: token.id }, data: { lastUsedAt: now } });
      } catch (err) {
        this.logger.warn(
          `Failed to stamp lastUsedAt on token ${token.id}: ${(err as Error).message}`,
        );
      }
    }

    return {
      tokenId: token.id,
      userId: token.userId,
      scopes: parseScopes(token.scopes),
      email: token.user.email,
      name: token.user.name,
    };
  }

  /** Audit rows carry ids and scopes — never the token, never its hash. */
  private async writeAudit(
    userId: string,
    action: 'API_TOKEN_CREATED' | 'API_TOKEN_REVOKED',
    tokenId: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId,
          action,
          entity: 'ApiToken',
          entityId: tokenId,
          details: details as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to write audit log for ${action} ${tokenId}: ${(err as Error).message}`,
      );
    }
  }
}

/** Stored scopes are a comma-separated list; anything unknown grants nothing. */
function parseScopes(stored: string): ApiTokenScope[] {
  return stored
    .split(',')
    .map((scope) => scope.trim())
    .filter((scope): scope is ApiTokenScope =>
      (API_TOKEN_SCOPES as readonly string[]).includes(scope),
    );
}
