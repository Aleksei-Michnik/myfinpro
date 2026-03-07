import { stagingFetchJson } from './helpers';

describe('Staging – GET /', () => {
  it('should return 200 status', async () => {
    const { status } = await stagingFetchJson('/');
    expect(status).toBe(200);
  });

  it('should contain name "MyFinPro API"', async () => {
    const { body } = await stagingFetchJson('/');
    expect(body.name).toBe('MyFinPro API');
  });

  it('should contain status "ok"', async () => {
    const { body } = await stagingFetchJson('/');
    expect(body.status).toBe('ok');
  });

  it('should contain a version field', async () => {
    const { body } = await stagingFetchJson('/');
    expect(body.version).toBeDefined();
    expect(typeof body.version).toBe('string');
  });
});
