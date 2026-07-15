import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

/** PUT /llm/credentials/:provider body — write-only, never echoed back. */
export class SetLlmCredentialDto {
  @ApiProperty({ description: 'Provider API key; stored encrypted, returned only as a hint.' })
  @IsString()
  @Length(20, 300)
  apiKey!: string;
}
