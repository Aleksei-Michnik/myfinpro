import { ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { MetricsService } from '../metrics/metrics.service';
import { AllExceptionsFilter } from './all-exceptions.filter';

// Mock the request-context module
jest.mock('../context/request-context', () => ({
  getRequestId: jest.fn().mockReturnValue('test-request-id'),
}));

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let mockResponse: {
    status: jest.Mock;
    json: jest.Mock;
  };
  let mockRequest: {
    url: string;
    method: string;
    headers: Record<string, string>;
  };
  let mockHost: ArgumentsHost;
  let loggerErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    // Ensure non-production mode for most tests
    process.env.NODE_ENV = 'test';

    filter = new AllExceptionsFilter();

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockRequest = {
      url: '/test-path',
      method: 'GET',
      headers: {},
    };

    mockHost = {
      switchToHttp: jest.fn().mockReturnValue({
        getResponse: jest.fn().mockReturnValue(mockResponse),
        getRequest: jest.fn().mockReturnValue(mockRequest),
      }),
      getArgs: jest.fn(),
      getArgByIndex: jest.fn(),
      switchToRpc: jest.fn(),
      switchToWs: jest.fn(),
      getType: jest.fn(),
    } as unknown as ArgumentsHost;

    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    loggerErrorSpy.mockRestore();
    delete process.env.NODE_ENV;
  });

  it('should be defined', () => {
    expect(filter).toBeDefined();
  });

  describe('handling HttpException', () => {
    it('should extract status and message from HttpException', () => {
      const exception = new HttpException('Not Found', HttpStatus.NOT_FOUND);

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.NOT_FOUND,
          message: 'Not Found',
          error: 'HttpException',
        }),
      );
    });

    it('should handle HttpException with object response', () => {
      const exception = new HttpException(
        { message: 'Validation failed', statusCode: 400 },
        HttpStatus.BAD_REQUEST,
      );

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Validation failed',
        }),
      );
    });
  });

  describe('handling unknown exceptions', () => {
    it('should return 500 and "Internal server error" for non-HTTP exceptions', () => {
      const exception = new Error('Something broke');

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Internal server error',
          error: 'InternalServerError',
        }),
      );
    });

    it('should return 500 for non-Error thrown values', () => {
      filter.catch('string error', mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'InternalServerError',
        }),
      );
    });
  });

  describe('response format', () => {
    it('should include statusCode, message, error, timestamp, and path', () => {
      const exception = new HttpException('Forbidden', HttpStatus.FORBIDDEN);

      filter.catch(exception, mockHost);

      const responseBody = mockResponse.json.mock.calls[0][0];
      expect(responseBody).toHaveProperty('statusCode');
      expect(responseBody).toHaveProperty('message');
      expect(responseBody).toHaveProperty('error');
      expect(responseBody).toHaveProperty('timestamp');
      expect(responseBody).toHaveProperty('path', '/test-path');
    });

    it('should include a valid ISO timestamp', () => {
      const exception = new HttpException('Bad Request', HttpStatus.BAD_REQUEST);

      filter.catch(exception, mockHost);

      const responseBody = mockResponse.json.mock.calls[0][0];
      const timestamp = new Date(responseBody.timestamp);
      expect(timestamp.toISOString()).toBe(responseBody.timestamp);
    });

    it('should include requestId in the response', () => {
      const exception = new HttpException('Error', HttpStatus.BAD_REQUEST);

      filter.catch(exception, mockHost);

      const responseBody = mockResponse.json.mock.calls[0][0];
      expect(responseBody).toHaveProperty('requestId', 'test-request-id');
    });
  });

  describe('logging', () => {
    it('should log errors via Logger', () => {
      const exception = new Error('Test error');

      filter.catch(exception, mockHost);

      expect(loggerErrorSpy).toHaveBeenCalled();
    });

    it('should include method and URL in the log message', () => {
      const exception = new Error('Test error');

      filter.catch(exception, mockHost);

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('GET /test-path'),
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('production mode', () => {
    it('should return generic "Internal server error" message in production for non-HTTP exceptions', () => {
      process.env.NODE_ENV = 'production';

      const exception = new Error('Sensitive details here');

      filter.catch(exception, mockHost);

      const responseBody = mockResponse.json.mock.calls[0][0];
      expect(responseBody.message).toBe('Internal server error');
      expect(responseBody).not.toHaveProperty('stack');
    });
  });

  describe('metrics integration', () => {
    it('should call metricsService.incrementErrors when provided', () => {
      const mockMetricsService = {
        incrementErrors: jest.fn(),
      };
      const filterWithMetrics = new AllExceptionsFilter(mockMetricsService as unknown as MetricsService);
      const exception = new Error('Test');

      filterWithMetrics.catch(exception, mockHost);

      expect(mockMetricsService.incrementErrors).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    });

    it('should not throw when metricsService is not provided', () => {
      const exception = new Error('Test');

      expect(() => filter.catch(exception, mockHost)).not.toThrow();
    });
  });
});
