import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

@Injectable()
export class PasswordService {
  private readonly hashOptions: argon2.Options = {
    type: argon2.argon2id, // Hybrid: resistant to both side-channel and GPU attacks
    memoryCost: 65536, // 64 MB memory
    timeCost: 3, // 3 iterations
    parallelism: 4, // 4 parallel threads
    hashLength: 32, // 32 bytes output
  };

  async hash(password: string): Promise<string> {
    return argon2.hash(password, this.hashOptions);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }
}
