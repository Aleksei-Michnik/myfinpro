import { PinoLogger } from 'nestjs-pino';

import { AppLoggerService } from './logger.service';

interface MockPinoLogger {
  trace: jest.Mock;
  debug: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
  fatal: jest.Mock;
}

describe('AppLoggerService', () => {
  let service: AppLoggerService;
  let mockPinoLogger: MockPinoLogger;

  beforeEach(() => {
    mockPinoLogger = {
      trace: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      fatal: jest.fn(),
    };

    service = new AppLoggerService(mockPinoLogger as unknown as PinoLogger);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should call trace with context', () => {
    service.trace('test message', { key: 'value' });
    expect(mockPinoLogger.trace).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'value' }),
      'test message',
    );
  });

  it('should call debug with context', () => {
    service.debug('test message', { key: 'value' });
    expect(mockPinoLogger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'value' }),
      'test message',
    );
  });

  it('should call info with context', () => {
    service.info('test message', { key: 'value' });
    expect(mockPinoLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'value' }),
      'test message',
    );
  });

  it('should call warn with context', () => {
    service.warn('test message', { key: 'value' });
    expect(mockPinoLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'value' }),
      'test message',
    );
  });

  it('should call error with context', () => {
    service.error('test message', { key: 'value' });
    expect(mockPinoLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'value' }),
      'test message',
    );
  });

  it('should call fatal with context', () => {
    service.fatal('test message', { key: 'value' });
    expect(mockPinoLogger.fatal).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'value' }),
      'test message',
    );
  });

  it('should work without context', () => {
    service.info('test message');
    expect(mockPinoLogger.info).toHaveBeenCalledWith(
      expect.any(Object),
      'test message',
    );
  });
});
