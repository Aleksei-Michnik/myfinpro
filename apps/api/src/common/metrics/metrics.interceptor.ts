import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const startTime = Date.now();
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    this.metricsService.incrementActiveConnections();

    return next.handle().pipe(
      tap({
        next: () => {
          this.recordMetric(request, response, startTime);
        },
        error: () => {
          this.recordMetric(request, response, startTime);
        },
        finalize: () => {
          this.metricsService.decrementActiveConnections();
        },
      }),
    );
  }

  private recordMetric(
    request: Request,
    response: Response,
    startTime: number,
  ): void {
    this.metricsService.recordRequest({
      method: request.method,
      path: request.url,
      statusCode: response.statusCode,
      duration: Date.now() - startTime,
      timestamp: Date.now(),
    });
  }
}
