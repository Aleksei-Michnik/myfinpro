import { Test, TestingModule } from '@nestjs/testing';

import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = module.get<AppController>(AppController);
  });

  describe('getRoot', () => {
    it('should return API info', () => {
      const result = appController.getRoot();
      expect(result).toHaveProperty('name', 'MyFinPro API');
      expect(result).toHaveProperty('status', 'ok');
    });
  });
});
