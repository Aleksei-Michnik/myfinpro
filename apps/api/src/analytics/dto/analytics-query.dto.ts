import {
  ANALYTICS_DIMENSIONS,
  ANALYTICS_GRANULARITIES,
  ANALYTICS_MAX_DIMENSIONS,
  ANALYTICS_SORT_FIELDS,
  CURRENCY_CODES,
  PAGINATION_DEFAULTS,
  TRANSACTION_DIRECTIONS,
  type AnalyticsDimension,
  type AnalyticsGranularity,
  type AnalyticsSortField,
  type TransactionDirection,
} from '@myfinpro/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { AttributionDto } from '../../transaction/dto/attribution.dto';

/** Sanity cap on id-list filters — analytics is exploratory, not bulk lookup. */
const MAX_FILTER_IDS = 100;

/**
 * POST /analytics/query body — Phase 9, iteration 9.1 (design §2.5, §5).
 *
 * Shape/range validation only. Semantics that need context — granularity ⇔
 * period pairing, date ordering, group membership on scope filters, cursor
 * fingerprint — live in AnalyticsEngineService.
 */
export class AnalyticsFiltersDto {
  @ApiPropertyOptional({ enum: [...TRANSACTION_DIRECTIONS], default: 'OUT' })
  @IsOptional()
  @IsIn([...TRANSACTION_DIRECTIONS])
  direction?: TransactionDirection;

  @ApiPropertyOptional({
    type: [AttributionDto],
    description: 'Narrow to these attribution scopes; default = everything accessible.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AttributionDto)
  scopes?: AttributionDto[];

  @ApiPropertyOptional({ description: 'ISO 8601 inclusive lower bound (transaction date).' })
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 exclusive upper bound (transaction date).' })
  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @ApiPropertyOptional({ type: [String], description: 'Effective category ids (design §2.1).' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FILTER_IDS)
  @IsUUID(undefined, { each: true })
  categoryIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FILTER_IDS)
  @IsUUID(undefined, { each: true })
  merchantIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Selects item rows only (design §2.1).' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FILTER_IDS)
  @IsUUID(undefined, { each: true })
  productIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Transaction creators.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FILTER_IDS)
  @IsUUID(undefined, { each: true })
  memberIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'ISO 4217 codes from the supported list.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsIn([...CURRENCY_CODES], { each: true })
  currencies?: string[];
}

export class AnalyticsSortDto {
  @ApiProperty({ enum: [...ANALYTICS_SORT_FIELDS] })
  @IsIn([...ANALYTICS_SORT_FIELDS])
  by!: AnalyticsSortField;

  @ApiProperty({ enum: ['asc', 'desc'] })
  @IsIn(['asc', 'desc'])
  dir!: 'asc' | 'desc';
}

export class AnalyticsQueryDto {
  @ApiProperty({
    enum: [...ANALYTICS_DIMENSIONS],
    isArray: true,
    description: `0–${ANALYTICS_MAX_DIMENSIONS} dimensions to group by; [] = grand totals per currency.`,
  })
  @IsArray()
  @ArrayMaxSize(ANALYTICS_MAX_DIMENSIONS)
  @ArrayUnique()
  @IsIn([...ANALYTICS_DIMENSIONS], { each: true })
  dimensions!: AnalyticsDimension[];

  @ApiPropertyOptional({
    enum: [...ANALYTICS_GRANULARITIES],
    description: "Required iff dimensions include 'period'.",
  })
  @IsOptional()
  @IsIn([...ANALYTICS_GRANULARITIES])
  granularity?: AnalyticsGranularity;

  @ApiPropertyOptional({ type: AnalyticsFiltersDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AnalyticsFiltersDto)
  filters?: AnalyticsFiltersDto;

  @ApiPropertyOptional({ type: AnalyticsSortDto, description: 'Default: spend desc.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => AnalyticsSortDto)
  sort?: AnalyticsSortDto;

  @ApiPropertyOptional({ default: PAGINATION_DEFAULTS.DEFAULT_LIMIT })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(PAGINATION_DEFAULTS.MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({ description: 'Opaque cursor from a previous response.' })
  @IsOptional()
  @IsString()
  cursor?: string;
}
