import { getStagingApiUrl } from './helpers';

describe('Staging – Swagger docs', () => {
  const getDocsUrl = (path: string) => {
    // Swagger is at /api/docs, not under /api/v1/
    const baseUrl = getStagingApiUrl().replace('/v1', '');
    return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  };

  it('should return 200 for Swagger UI at /api/docs', async () => {
    const response = await fetch(getDocsUrl('/docs'));
    expect(response.status).toBe(200);
  });

  it('should return HTML content for Swagger UI', async () => {
    const response = await fetch(getDocsUrl('/docs'));
    const contentType = response.headers.get('content-type') || '';
    expect(contentType).toContain('text/html');
  });

  it('should return valid OpenAPI JSON at /api/docs-json', async () => {
    const response = await fetch(getDocsUrl('/docs-json'));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.openapi).toBeDefined();
    expect(typeof body.openapi).toBe('string');
  });
});
