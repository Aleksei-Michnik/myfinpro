import { IncomingMessage, ServerResponse } from 'http';

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';

import { getRequestId } from '../context/request-context';

import { AppLoggerService } from './logger.service';

/** Serialized request object shape from pino-std-serializers */
interface PinoSerializedRequest {
  id: string;
  method: string;
  url: string;
  query: Record<string, unknown>;
  params: Record<string, unknown>;
  headers: Record<string, unknown>;
}

/** Serialized response object shape from pino-std-serializers */
interface PinoSerializedResponse {
  statusCode: number;
}

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const nodeEnv = configService.get<string>('NODE_ENV', 'development');
        const isProduction = nodeEnv === 'production';
        const logLevel = configService.get<string>('LOG_LEVEL', 'info');

        return {
          pinoHttp: {
            level: logLevel,
            // Generate request ID from context or header
            genReqId: (req: IncomingMessage) => {
              return (
                getRequestId() ||
                (req.headers?.['x-request-id'] as string) ||
                'unknown'
              );
            },
            // Redact sensitive fields
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.body.password',
                'req.body.token',
                'req.body.refreshToken',
                'req.body.accessToken',
                'req.body.currentPassword',
                'req.body.newPassword',
              ],
              censor: '[REDACTED]',
            },
            // Custom serializers
            serializers: {
              req: (req: PinoSerializedRequest) => ({
                id: req.id,
                method: req.method,
                url: req.url,
                query: req.query,
                params: req.params,
                // Don't log full headers in production
                ...(isProduction
                  ? {}
                  : { headers: req.headers }),
              }),
              res: (res: PinoSerializedResponse) => ({
                statusCode: res.statusCode,
              }),
            },
            // Custom log level based on status code
            customLogLevel: (
              _req: IncomingMessage,
              res: ServerResponse,
              err: Error | undefined,
            ) => {
              if (res.statusCode >= 500 || err) return 'error';
              if (res.statusCode >= 400) return 'warn';
              return 'info';
            },
            // Custom success message
            customSuccessMessage: (req: IncomingMessage, res: ServerResponse) => {
              return `${req.method} ${req.url} ${res.statusCode}`;
            },
            // Custom error message
            customErrorMessage: (req: IncomingMessage, res: ServerResponse) => {
              return `${req.method} ${req.url} ${res.statusCode}`;
            },
            transport: isProduction
              ? undefined
              : {
                  target: 'pino-pretty',
                  options: {
                    colorize: true,
                    singleLine: false,
                    translateTime: 'SYS:standard',
                    ignore: 'pid,hostname',
                  },
                },
          },
        };
      },
    }),
  ],
  providers: [AppLoggerService],
  exports: [AppLoggerService, PinoLoggerModule],
})
export class LoggerModule {}
