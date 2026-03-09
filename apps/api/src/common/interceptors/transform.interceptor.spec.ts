import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of, lastValueFrom } from 'rxjs';
import { TransformInterceptor } from './transform.interceptor';

describe('TransformInterceptor', () => {
  let interceptor: TransformInterceptor<unknown>;
  let mockExecutionContext: ExecutionContext;

  beforeEach(() => {
    interceptor = new TransformInterceptor();
    mockExecutionContext = {} as ExecutionContext;
  });

  it('should be defined', () => {
    expect(interceptor).toBeDefined();
  });

  describe('intercept', () => {
    it('should wrap plain data in { data: T } envelope', async () => {
      const plainData = { id: 1, name: 'Test' };
      const callHandler: CallHandler = {
        handle: () => of(plainData),
      };

      const result$ = interceptor.intercept(mockExecutionContext, callHandler);
      const result = await lastValueFrom(result$);

      expect(result).toEqual({ data: plainData });
    });

    it('should wrap a string value in { data } envelope', async () => {
      const callHandler: CallHandler = {
        handle: () => of('hello'),
      };

      const result$ = interceptor.intercept(mockExecutionContext, callHandler);
      const result = await lastValueFrom(result$);

      expect(result).toEqual({ data: 'hello' });
    });

    it('should wrap a number value in { data } envelope', async () => {
      const callHandler: CallHandler = {
        handle: () => of(42),
      };

      const result$ = interceptor.intercept(mockExecutionContext, callHandler);
      const result = await lastValueFrom(result$);

      expect(result).toEqual({ data: 42 });
    });

    it('should wrap null in { data } envelope', async () => {
      const callHandler: CallHandler = {
        handle: () => of(null),
      };

      const result$ = interceptor.intercept(mockExecutionContext, callHandler);
      const result = await lastValueFrom(result$);

      expect(result).toEqual({ data: null });
    });

    it('should wrap an array in { data } envelope', async () => {
      const arrayData = [1, 2, 3];
      const callHandler: CallHandler = {
        handle: () => of(arrayData),
      };

      const result$ = interceptor.intercept(mockExecutionContext, callHandler);
      const result = await lastValueFrom(result$);

      expect(result).toEqual({ data: arrayData });
    });

    it('should pass through data that already has a "data" key (paginated responses)', async () => {
      const paginatedData = {
        data: [{ id: 1 }, { id: 2 }],
        meta: { total: 100, page: 1, limit: 10 },
      };
      const callHandler: CallHandler = {
        handle: () => of(paginatedData),
      };

      const result$ = interceptor.intercept(mockExecutionContext, callHandler);
      const result = await lastValueFrom(result$);

      expect(result).toEqual(paginatedData);
      expect(result).toBe(paginatedData); // same reference, not re-wrapped
    });

    it('should pass through object with "data" key even if data is empty', async () => {
      const responseWithData = { data: [] };
      const callHandler: CallHandler = {
        handle: () => of(responseWithData),
      };

      const result$ = interceptor.intercept(mockExecutionContext, callHandler);
      const result = await lastValueFrom(result$);

      expect(result).toEqual(responseWithData);
      expect(result).toBe(responseWithData);
    });
  });
});
