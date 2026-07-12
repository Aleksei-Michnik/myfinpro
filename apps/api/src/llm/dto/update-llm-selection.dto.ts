import { LLM_PROVIDERS } from '@myfinpro/shared';
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Length, ValidateIf } from 'class-validator';

/**
 * PUT /llm/selection body. Both fields explicit: a catalog pair selects a
 * model, both null reverts to the deployment default. The pair itself is
 * validated against the shared catalog in the service.
 */
export class UpdateLlmSelectionDto {
  @ApiProperty({ enum: LLM_PROVIDERS, nullable: true })
  @ValidateIf((o: UpdateLlmSelectionDto) => o.provider !== null)
  @IsIn([...LLM_PROVIDERS])
  provider!: string | null;

  @ApiProperty({ example: 'claude-sonnet-5', nullable: true })
  @ValidateIf((o: UpdateLlmSelectionDto) => o.model !== null)
  @IsString()
  @Length(1, 60)
  model!: string | null;
}
