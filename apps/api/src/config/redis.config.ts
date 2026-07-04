import { ConfigService, registerAs } from '@nestjs/config';

/**
 * Connection options consumed by BullMQ (`connection: ConnectionOptions`).
 *
 * BullMQ v5+ wraps ioredis internally — we hand it a host/port/password/tls
 * object and it handles reconnects, lazy connect, and retry strategies.
 */
export interface RedisConnectionOptions {
  host: string;
  port: number;
  password: string | undefined;
  tls: { rejectUnauthorized: boolean } | undefined;
}

/**
 * Read REDIS_* env vars and produce a typed connection object.
 *
 * Defaults are tuned for local development:
 *  - host=localhost, port=6379, no password, plaintext.
 *
 * On staging/production every value is provided by the GitHub-secret
 * injection pattern (see [`docker-compose.staging.app.yml`](docker-compose.staging.app.yml:1)
 * and the deploy workflows). No `.env` file is ever written to disk on those
 * hosts.
 */
export function buildRedisConnection(config: ConfigService): RedisConnectionOptions {
  const password = config.get<string>('REDIS_PASSWORD');
  const tlsEnabled = config.get<string>('REDIS_TLS') === 'true';

  return {
    host: config.get<string>('REDIS_HOST', 'localhost'),
    port: parseInt(config.get<string>('REDIS_PORT', '6379'), 10),
    password: password && password.length > 0 ? password : undefined,
    tls: tlsEnabled ? { rejectUnauthorized: true } : undefined,
  };
}

/**
 * Nest-config namespace registration so callers can also do
 * `config.get('redis.host')` if they prefer the typed-namespace style.
 */
export default registerAs('redis', () => ({
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  tlsEnabled: process.env.REDIS_TLS === 'true',
}));
