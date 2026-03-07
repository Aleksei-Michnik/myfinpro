import { stagingFetch } from './helpers';

describe('Staging – Rate limiting headers', () => {
  it('should include x-ratelimit-limit header', async () => {
    const response = await stagingFetch('/');
    const limit = response.headers.get('x-ratelimit-limit');
    expect(limit).not.toBeNull();
  });

  it('should include x-ratelimit-remaining header', async () => {
    const response = await stagingFetch('/');
    const remaining = response.headers.get('x-ratelimit-remaining');
    expect(remaining).not.toBeNull();
  });

  it('should have numeric x-ratelimit-limit value', async () => {
    const response = await stagingFetch('/');
    const limit = response.headers.get('x-ratelimit-limit');
    expect(limit).not.toBeNull();
    expect(Number(limit)).not.toBeNaN();
    expect(Number(limit)).toBeGreaterThan(0);
  });

  it('should have numeric x-ratelimit-remaining value', async () => {
    const response = await stagingFetch('/');
    const remaining = response.headers.get('x-ratelimit-remaining');
    expect(remaining).not.toBeNull();
    expect(Number(remaining)).not.toBeNaN();
    expect(Number(remaining)).toBeGreaterThanOrEqual(0);
  });
});
