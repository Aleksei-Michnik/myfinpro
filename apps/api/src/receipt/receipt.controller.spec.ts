import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ReceiptController } from './receipt.controller';
import { ReceiptService } from './receipt.service';

describe('ReceiptController', () => {
  let controller: ReceiptController;
  let service: {
    createFromUpload: jest.Mock;
    createFromUrl: jest.Mock;
    createManual: jest.Mock;
    list: jest.Mock;
    getOne: jest.Mock;
    openFile: jest.Mock;
    retry: jest.Mock;
    remove: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      createFromUpload: jest.fn(),
      createFromUrl: jest.fn(),
      createManual: jest.fn(),
      list: jest.fn(),
      getOne: jest.fn(),
      openFile: jest.fn(),
      retry: jest.fn(),
      remove: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReceiptController],
      providers: [{ provide: ReceiptService, useValue: service }],
    }).compile();
    controller = module.get(ReceiptController);
  });

  const user = { sub: 'u1' } as { sub: string };

  it('POST → service.createFromUpload with the multipart buffer', async () => {
    service.createFromUpload.mockResolvedValue({ id: 'r1' });
    const buffer = Buffer.from('x');
    const res = await controller.upload(user as never, {
      buffer,
      originalname: 'receipt.jpg',
      size: 1,
    });
    expect(service.createFromUpload).toHaveBeenCalledWith('u1', buffer, 'receipt.jpg');
    expect(res).toEqual({ id: 'r1' });
  });

  it('POST without a file → structured 400 before the service is touched', async () => {
    await expect(controller.upload(user as never, undefined)).rejects.toThrow(BadRequestException);
    expect(service.createFromUpload).not.toHaveBeenCalled();
  });

  it('POST /url → service.createFromUrl', async () => {
    service.createFromUrl.mockResolvedValue({ id: 'r1' });
    await controller.createFromUrl(user as never, { url: 'https://r.example/x' });
    expect(service.createFromUrl).toHaveBeenCalledWith('u1', { url: 'https://r.example/x' });
  });

  it('POST /manual → service.createManual', async () => {
    service.createManual.mockResolvedValue({ id: 'r1' });
    const dto = {
      currency: 'ILS',
      items: [{ productId: 'p-1', quantity: 1, unitPriceCents: 500 }],
    };
    await controller.createManual(user as never, dto as never);
    expect(service.createManual).toHaveBeenCalledWith('u1', dto);
  });

  it('GET → service.list; GET /:id → service.getOne; POST /:id/retry; DELETE', async () => {
    service.list.mockResolvedValue({ data: [], nextCursor: null, hasMore: false });
    await controller.list(user as never, { status: 'REVIEW' });
    expect(service.list).toHaveBeenCalledWith('u1', { status: 'REVIEW' });

    service.getOne.mockResolvedValue({ id: 'r1' });
    await controller.getOne(user as never, 'r1');
    expect(service.getOne).toHaveBeenCalledWith('u1', 'r1');

    service.retry.mockResolvedValue({ id: 'r1' });
    await controller.retry(user as never, 'r1');
    expect(service.retry).toHaveBeenCalledWith('u1', 'r1');

    service.remove.mockResolvedValue(undefined);
    await controller.remove(user as never, 'r1');
    expect(service.remove).toHaveBeenCalledWith('u1', 'r1');
  });

  it('GET /:id/file pipes the stream with content headers', async () => {
    const pipe = jest.fn();
    service.openFile.mockResolvedValue({
      stream: { pipe },
      mimeType: 'application/pdf',
      sizeBytes: 42,
    });
    const res = { setHeader: jest.fn() } as never;
    await controller.downloadFile(user as never, 'r1', res);
    expect(service.openFile).toHaveBeenCalledWith('u1', 'r1');
    const headers = (res as { setHeader: jest.Mock }).setHeader.mock.calls;
    expect(headers).toEqual(
      expect.arrayContaining([
        ['Content-Type', 'application/pdf'],
        ['Content-Length', '42'],
        ['Content-Disposition', 'inline'],
      ]),
    );
    expect(pipe).toHaveBeenCalledWith(res);
  });
});
