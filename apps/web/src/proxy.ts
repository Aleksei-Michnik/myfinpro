import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Match all paths except: api routes, _next assets, _vercel internals, static files
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
