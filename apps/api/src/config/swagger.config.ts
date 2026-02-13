import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function setupSwagger(app: INestApplication, globalPrefix: string): void {
  const config = new DocumentBuilder()
    .setTitle('MyFinPro API')
    .setDescription(
      'Personal/Family Finance Management API. ' +
        'All monetary amounts are stored as integer cents. ' +
        'Currency codes follow ISO 4217.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        description: 'Enter JWT token',
        in: 'header',
      },
      'access-token',
    )
    .addServer(`http://localhost:4000/${globalPrefix}`, 'Local Development')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  // Swagger served at /api/docs (strip /v1 from prefix for docs path)
  const docsPath = globalPrefix.replace('/v1', '') + '/docs';
  SwaggerModule.setup(docsPath, app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });
}
