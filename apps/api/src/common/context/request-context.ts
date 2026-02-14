import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

export interface RequestContextData {
  requestId: string;
  userId?: string;
  startTime: number;
}

export const requestContextStorage = new AsyncLocalStorage<RequestContextData>();

export function createRequestContext(requestId?: string): RequestContextData {
  return {
    requestId: requestId || randomUUID(),
    startTime: Date.now(),
  };
}

export function getRequestContext(): RequestContextData | undefined {
  return requestContextStorage.getStore();
}

export function getRequestId(): string | undefined {
  return requestContextStorage.getStore()?.requestId;
}
