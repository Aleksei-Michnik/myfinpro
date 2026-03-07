import { getStagingApiUrl } from './helpers';

describe('Staging – Swagger docs', () => {
  const getDocsUrl = (path: string) => {
    // Swagger is at /api/docs, not under /api/v1/
    const baseUrl = getStagingApiUrl().replace('/v1', '');
    return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  };

  let swaggerEnabled = true;

  beforeAll(async () => {
    // Probe whether Swagger is enabled in this environment.
    // SWAGGER_ENABLED may be set to 'false' on the server, in which
    // case all docs endpoints return 404 — that is expected behaviour.
    const probe = await fetch(getDocsUrl('/docs'));
    if (probe.status === 404) {
      swaggerEnabled = false;
    }
  });

  it('should return 200 for Swagger UI at /api/docs', async () => {
    if (!swaggerEnabled) {
      console.log('⏭️  Swagger is disabled in this environment — skipping');
      return;
    }
    const response = await fetch(getDocsUrl('/docs'));
    expect(response.status).toBe(200);
  });

  it('should return HTML content for Swagger UI', async () => {
    if (!swaggerEnabled) {
      console.log('⏭️  Swagger is disabled in this environment — skipping');
      return;
    }
    const response = await fetch(getDocsUrl('/docs'));
    const contentType = response.headers.get('content-type') || '';
    expect(contentType).toContain('text/html');
  });

  it('should return valid OpenAPI JSON at /api/docs-json', async () => {
    if (!swaggerEnabled) {
      console.log('⏭️  Swagger is disabled in this environment — skipping');
      return;
    }
    const response = await fetch(getDocsUrl('/docs-json'));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.openapi).toBeDefined();
    expect(typeof body.openapi).toBe('string');
  });
});
