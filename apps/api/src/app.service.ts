import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getRoot() {
    return {
      name: 'MyFinPro API',
      version: '0.1.0',
      status: 'ok',
    };
  }
}
