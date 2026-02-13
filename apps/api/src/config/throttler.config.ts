import { registerAs } from '@nestjs/config';

export default registerAs('throttler', () => ({
  ttl: parseInt(process.env.RATE_LIMIT_TTL || '60000', 10),
  limit: parseInt(process.env.RATE_LIMIT_MAX || '60', 10),
  authTtl: parseInt(process.env.RATE_LIMIT_AUTH_TTL || '60000', 10),
  authLimit: parseInt(process.env.RATE_LIMIT_AUTH_MAX || '5', 10),
}));
