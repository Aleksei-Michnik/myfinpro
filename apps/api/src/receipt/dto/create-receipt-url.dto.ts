import { ApiProperty } from '@nestjs/swagger';
import { IsUrl, MaxLength } from 'class-validator';

/** POST /receipts/url body (Phase 7.4). */
export class CreateReceiptUrlDto {
  @ApiProperty({
    description: 'Publicly reachable http(s) URL of an online receipt.',
    example: 'https://receipts.example.com/r/abc123',
  })
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { message: 'url must be a valid http(s) URL' },
  )
  @MaxLength(2000)
  url!: string;
}
