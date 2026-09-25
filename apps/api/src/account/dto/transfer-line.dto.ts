import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/**
 * POST /accounts/:id/lines/:lineId/transfer body (design §2.4 / §6.2).
 *
 * "The other account": the destination for an OUT line (the classic card
 * bill, bank → card) and the source for an IN line (the card side of the
 * same bill). The created row is always one OUT transaction filed under the
 * `transfer` system category, so it counts as spending nowhere.
 */
export class TransferLineDto {
  @ApiProperty({ description: 'The own account on the other side of the movement.' })
  @IsUUID()
  transferAccountId!: string;
}
