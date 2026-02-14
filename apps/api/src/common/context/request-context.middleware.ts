import { randomUUID } from 'crypto';

import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

import { requestContextStorage, createRequestContext } from './request-context';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const requestId = (req.headers['x-request-id'] as string) || randomUUID();

    const context = createRequestContext(requestId);

    // Attach to request for easy access
    (req as Request & { requestId?: string }).requestId = requestId;

    requestContextStorage.run(context, () => {
      next();
    });
  }
}
