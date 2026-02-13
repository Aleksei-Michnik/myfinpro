import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';

import throttlerConfig from '../../config/throttler.config';

import { CustomThrottlerGuard } from './throttler.guard';

@Module({
  imports: [
    ConfigModule.forFeature(throttlerConfig),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: configService.get<number>('throttler.ttl', 60000),
            limit: configService.get<number>('throttler.limit', 60),
          },
        ],
      }),
    }),
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: CustomThrottlerGuard,
    },
  ],
})
export class AppThrottlerModule {}
