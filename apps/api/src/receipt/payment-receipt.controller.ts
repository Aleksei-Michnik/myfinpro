import { RECEIPT_MAX_FILE_SIZE_BYTES } from '@myfinpro/shared';
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CustomThrottle } from '../common/decorators/throttle.decorator';
import { RECEIPT_ERRORS } from './constants/receipt-errors';
import { CreateReceiptUrlDto } from './dto/create-receipt-url.dto';
import { ReceiptResponseDto } from './dto/receipt-response.dto';
import { ReceiptService } from './receipt.service';

/**
 * Minimal multipart-file shape — mirrors ReceiptController (the repo carries
 * no @types/multer; only these fields are consumed).
 */
interface UploadedReceiptFile {
  buffer: Buffer;
  originalname?: string;
  size: number;
}

/**
 * Phase 8.15 — attach a receipt to an existing payment (design §3). Lives in
 * the receipt module (so it can use ReceiptService without a circular import
 * back into PaymentModule) but is routed under `/payments/:id` to match the
 * REST model: a receipt is that payment's proving document. The receipt is
 * created with `paymentId` set and extraction runs unchanged; the review is
 * finished via `POST /receipts/:id/reconcile`, not confirm.
 */
@ApiTags('Receipts')
@Controller('payments')
export class PaymentReceiptController {
  constructor(private readonly service: ReceiptService) {}

  @CustomThrottle({ limit: 20, ttl: 60_000 })
  @UseGuards(JwtAuthGuard)
  @Post(':id/receipt')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: RECEIPT_MAX_FILE_SIZE_BYTES + 1024 * 1024 } }),
  )
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiOperation({
    summary: 'Attach a receipt file to an existing expense payment',
    description:
      'Creates the receipt already linked to the payment and enqueues extraction. Finish the ' +
      'review with POST /receipts/:id/reconcile. One receipt per payment; expense payments ' +
      'you created only (404 otherwise).',
  })
  @ApiOkResponse({ description: 'Receipt created + linked', type: ReceiptResponseDto })
  @ApiNotFoundResponse({ description: 'Payment not found / not the creator' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid JWT' })
  @ApiTooManyRequestsResponse({ description: 'Rate limited' })
  async attachFile(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) paymentId: string,
    @UploadedFile() file: UploadedReceiptFile | undefined,
  ): Promise<ReceiptResponseDto> {
    if (!file || !file.buffer) {
      throw new BadRequestException({
        message: "Multipart field 'file' is required",
        errorCode: RECEIPT_ERRORS.RECEIPT_INVALID_FILE_TYPE,
      });
    }
    return this.service.createFromUpload(
      user.sub,
      file.buffer,
      file.originalname ?? null,
      paymentId,
    );
  }

  @CustomThrottle({ limit: 20, ttl: 60_000 })
  @UseGuards(JwtAuthGuard)
  @Post(':id/receipt-url')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Attach an online receipt by URL to an existing expense payment',
    description: 'Same as the file attach, but the worker fetches the URL. Finish via reconcile.',
  })
  @ApiOkResponse({ description: 'Receipt created + linked', type: ReceiptResponseDto })
  @ApiNotFoundResponse({ description: 'Payment not found / not the creator' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid JWT' })
  @ApiTooManyRequestsResponse({ description: 'Rate limited' })
  async attachUrl(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) paymentId: string,
    @Body() dto: CreateReceiptUrlDto,
  ): Promise<ReceiptResponseDto> {
    return this.service.createFromUrl(user.sub, dto, paymentId);
  }
}
