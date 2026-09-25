import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/** POST /accounts/:id/lines/:lineId/match body (design §6.2). */
export class MatchLineDto {
  @ApiProperty({
    description:
      'The existing transaction this bank line records. Must be visible to the caller, ' +
      'not yet confirmed by another line, and agree on amount, currency and direction.',
  })
  @IsUUID()
  transactionId!: string;
}
