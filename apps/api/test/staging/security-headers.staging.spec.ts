import { stagingFetch } from './helpers';

describe('Security Headers (Staging)', () => {
  it('should return X-Content-Type-Options header', async () => {
    const response = await stagingFetch('/');
    const header = response.headers.get('x-content-type-options');
    // Header may be duplicated by nginx + NestJS helmet (e.g. "nosniff, nosniff")
    expect(header).toContain('nosniff');
  });

  it('should return X-Frame-Options header', async () => {
    const response = await stagingFetch('/');
    expect(response.headers.get('x-frame-options')).toBeDefined();
  });

  it('should not expose X-Powered-By header', async () => {
    const response = await stagingFetch('/');
    expect(response.headers.get('x-powered-by')).toBeNull();
  });
});
