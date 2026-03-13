import { stagingFetch } from './helpers';

describe('Security Headers (Staging)', () => {
  it('should return X-Content-Type-Options header', async () => {
    const response = await stagingFetch('/');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
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
