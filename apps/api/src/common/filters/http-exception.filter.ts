import { ExceptionFilter, Catch, ArgumentsHost, HttpException, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { getRequestId } from '../context/request-context';
import { MetricsService } from '../metrics/metrics.service';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  constructor(private readonly metricsService?: MetricsService) {}

  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = exception.getStatus();
    const message = exception.getResponse();
    const isProduction = process.env.NODE_ENV === 'production';
    const requestId = getRequestId() || (request as Request & { requestId?: string }).requestId;

    const messageObj =
      typeof message === 'object' && message !== null ? (message as Record<string, unknown>) : null;
    const errorCode = messageObj?.errorCode as string | undefined;

    const errorResponse: Record<string, unknown> = {
      statusCode: status,
      message: typeof message === 'string' ? message : messageObj?.message || message,
      error: exception.name,
      timestamp: new Date().toISOString(),
      path: request.url,
      requestId,
    };

    if (errorCode) {
      errorResponse.errorCode = errorCode;
    }

    const logContext = {
      requestId,
      userId: (request as Request & { user?: { id?: string } }).user?.id,
      method: request.method,
      path: request.url,
      statusCode: status,
      ...(!isProduction && { stack: exception.stack }),
    };

    // Use appropriate log level based on status code
    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} ${status} - ${exception.message}`,
        JSON.stringify(logContext),
      );
    } else {
      this.logger.warn(
        `${request.method} ${request.url} ${status} - ${exception.message}`,
        JSON.stringify(logContext),
      );
    }

    // Track in metrics
    this.metricsService?.incrementErrors(status);

    response.status(status).json(errorResponse);
  }
}
