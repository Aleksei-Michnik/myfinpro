import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ReceiptService } from './receipt.service';
import { TransactionReceiptController } from './transaction-receipt.controller';

describe('TransactionReceiptController (8.15)', () => {
  let controller: TransactionReceiptController;
  let service: { createFromUpload: jest.Mock; createFromUrl: jest.Mock };

  const user = { sub: 'u1' } as { sub: string };

  beforeEach(async () => {
    service = { createFromUpload: jest.fn(), createFromUrl: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TransactionReceiptController],
      providers: [{ provide: ReceiptService, useValue: service }],
    }).compile();
    controller = module.get(TransactionReceiptController);
  });

  it('POST /transactions/:id/receipt → createFromUpload with the transactionId', async () => {
    service.createFromUpload.mockResolvedValue({ id: 'r1' });
    const buffer = Buffer.from('x');
    await controller.attachFile(user as never, 'pay-1', {
      buffer,
      originalname: 'r.jpg',
      size: 1,
    });
    expect(service.createFromUpload).toHaveBeenCalledWith('u1', buffer, 'r.jpg', 'pay-1');
  });

  it('POST /transactions/:id/receipt without a file → 400 before the service', async () => {
    await expect(controller.attachFile(user as never, 'pay-1', undefined)).rejects.toThrow(
      BadRequestException,
    );
    expect(service.createFromUpload).not.toHaveBeenCalled();
  });

  it('POST /transactions/:id/receipt-url → createFromUrl with the transactionId', async () => {
    service.createFromUrl.mockResolvedValue({ id: 'r1' });
    await controller.attachUrl(user as never, 'pay-1', { url: 'https://r.example/x' });
    expect(service.createFromUrl).toHaveBeenCalledWith(
      'u1',
      { url: 'https://r.example/x' },
      'pay-1',
    );
  });
});
