import { Request, Response, NextFunction } from 'express';

import { RequestContextMiddleware } from './request-context.middleware';
import { requestContextStorage, createRequestContext } from './request-context';

interface RequestWithId extends Record<string, unknown> {
  requestId?: string;
}

// Mock the request-context module
jest.mock('./request-context', () => ({
  requestContextStorage: {
    run: jest.fn((_ctx, callback) => callback()),
  },
  createRequestContext: jest.fn((requestId: string) => ({
    requestId,
    startTime: Date.now(),
  })),
}));

// Mock crypto.randomUUID
jest.mock('crypto', () => ({
  randomUUID: jest.fn().mockReturnValue('generated-uuid-1234'),
}));

describe('RequestContextMiddleware', () => {
  let middleware: RequestContextMiddleware;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;

  beforeEach(() => {
    middleware = new RequestContextMiddleware();
    mockResponse = {};
    nextFunction = jest.fn();
  });

  it('should be defined', () => {
    expect(middleware).toBeDefined();
  });

  describe('use', () => {
    it('should use request ID from x-request-id header if present', () => {
      mockRequest = {
        headers: { 'x-request-id': 'custom-request-id-abc' },
      };

      middleware.use(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(createRequestContext).toHaveBeenCalledWith('custom-request-id-abc');
      expect((mockRequest as unknown as RequestWithId).requestId).toBe('custom-request-id-abc');
    });

    it('should generate a UUID if x-request-id header is not present', () => {
      mockRequest = {
        headers: {},
      };

      middleware.use(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(createRequestContext).toHaveBeenCalledWith('generated-uuid-1234');
      expect((mockRequest as unknown as RequestWithId).requestId).toBe('generated-uuid-1234');
    });

    it('should call next() within the requestContextStorage.run callback', () => {
      mockRequest = {
        headers: {},
      };

      middleware.use(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(requestContextStorage.run).toHaveBeenCalled();
      expect(nextFunction).toHaveBeenCalled();
    });

    it('should attach requestId to the request object', () => {
      mockRequest = {
        headers: { 'x-request-id': 'header-id' },
      };

      middleware.use(mockRequest as Request, mockResponse as Response, nextFunction);

      expect((mockRequest as unknown as RequestWithId).requestId).toBe('header-id');
    });

    it('should pass the created context to requestContextStorage.run', () => {
      mockRequest = {
        headers: { 'x-request-id': 'test-id' },
      };

      middleware.use(mockRequest as Request, mockResponse as Response, nextFunction);

      const createdContext = (createRequestContext as jest.Mock).mock.results[0].value;
      expect(requestContextStorage.run).toHaveBeenCalledWith(createdContext, expect.any(Function));
    });
  });
});
