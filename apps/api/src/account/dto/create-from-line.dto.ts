import { TRANSACTION_MAX_CATEGORIES } from '@myfinpro/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateNested,
} from 'class-validator';
import { AttributionDto } from '../../transaction/dto/attribution.dto';

/**
 * POST /accounts/:id/lines/:lineId/create body (design §6.2).
 *
 * Everything else about the transaction comes from the bank line itself:
 * direction, amount, currency, `occurredAt = valueAt ?? postedAt`, the
 * account, and the description as the note. The row is created through
 * `TransactionService.create`, so category, attribution and currency
 * validation, the audit row and the realtime event stay in one place.
 */
export class CreateFromLineDto {
  @ApiProperty({
    type: [String],
    description: 'First element is the primary category; every one must match the direction.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(TRANSACTION_MAX_CATEGORIES)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  categoryIds!: string[];

  @ApiPropertyOptional({ description: "Defaults to the line's description." })
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  note?: string;

  @ApiPropertyOptional({
    type: [AttributionDto],
    description:
      "Defaults to the account's own scope — the owner for a personal account, the group " +
      'for a group account.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AttributionDto)
  attributions?: AttributionDto[];
}
