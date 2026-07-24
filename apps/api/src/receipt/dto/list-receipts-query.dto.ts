import { RECEIPT_STATUSES, type ReceiptStatus } from '@myfinpro/shared';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBooleanString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** GET /receipts query (Phase 7.4). Cursor is opaque base64url. */
export class ListReceiptsQueryDto {
  @ApiPropertyOptional({ enum: [...RECEIPT_STATUSES] })
  @IsOptional()
  @IsIn([...RECEIPT_STATUSES])
  status?: ReceiptStatus;

  /**
   * 8.28 — `true` narrows to link candidates: unattached receipts in REVIEW or
   * CONFIRMED (the states with reviewable data). Feeds the transaction-side
   * "link an existing receipt" picker.
   */
  @ApiPropertyOptional({ example: 'true' })
  @IsOptional()
  @IsBooleanString()
  linkable?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Opaque cursor from the previous page.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  cursor?: string;
}
