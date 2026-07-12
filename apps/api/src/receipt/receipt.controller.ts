import { RECEIPT_MAX_FILE_SIZE_BYTES } from '@myfinpro/shared';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CustomThrottle } from '../common/decorators/throttle.decorator';
import { RECEIPT_ERRORS } from './constants/receipt-errors';
import { ConfirmReceiptDto } from './dto/confirm-receipt.dto';
import { CreateReceiptUrlDto } from './dto/create-receipt-url.dto';
import { ListReceiptsQueryDto } from './dto/list-receipts-query.dto';
import { MatchItemDto } from './dto/match-item.dto';
import { ReceiptResponseDto } from './dto/receipt-response.dto';
import { ReplaceItemsDto } from './dto/replace-items.dto';
import { UpdateReceiptDto } from './dto/update-receipt.dto';
import { ReceiptService, type ReceiptListResponse } from './receipt.service';

/**
 * Minimal multipart-file shape — the repo carries no @types/multer;
 * only these fields are consumed (buffer-based memory storage).
 */
interface UploadedReceiptFile {
  buffer: Buffer;
  originalname?: string;
  size: number;
}

/**
 * Phase 7, iteration 7.4 — receipt ingestion REST surface.
 * Uploads use in-memory multer storage: the 10MB cap makes buffering
 * safe, and the storage service does magic-byte validation before
 * anything touches disk. multer's own fileSize limit sits 1 MB above the
 * whitelist cap so the common oversize case gets our structured 400
 * instead of a bare 413 (which still guards the extreme case).
 */
@ApiTags('Receipts')
@Controller('receipts')
export class ReceiptController {
  constructor(private readonly service: ReceiptService) {}

  @CustomThrottle({ limit: 20, ttl: 60_000 })
  @UseGuards(JwtAuthGuard)
  @Post()
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
    summary: 'Upload a receipt file',
    description:
      'JPEG / PNG / WebP / HEIC / PDF up to 10MB (validated from magic bytes). Creates the ' +
      'receipt in UPLOADED and enqueues async extraction; watch status via GET or the ' +
      'receipt.updated realtime event.',
  })
  @ApiOkResponse({ description: 'Receipt created', type: ReceiptResponseDto })
  @ApiPayloadTooLargeResponse({ description: 'File exceeds the hard multipart cap' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid JWT' })
  @ApiTooManyRequestsResponse({ description: 'Rate limited' })
  async upload(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: UploadedReceiptFile | undefined,
  ): Promise<ReceiptResponseDto> {
    if (!file || !file.buffer) {
      throw new BadRequestException({
        message: "Multipart field 'file' is required",
        errorCode: RECEIPT_ERRORS.RECEIPT_INVALID_FILE_TYPE,
      });
    }
    return this.service.createFromUpload(user.sub, file.buffer, file.originalname ?? null);
  }

  @CustomThrottle({ limit: 20, ttl: 60_000 })
  @UseGuards(JwtAuthGuard)
  @Post('url')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Ingest an online receipt by URL',
    description:
      'Stores the URL and enqueues extraction; the worker fetches a snapshot. Same lifecycle ' +
      'as file uploads.',
  })
  @ApiOkResponse({ description: 'Receipt created', type: ReceiptResponseDto })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid JWT' })
  @ApiTooManyRequestsResponse({ description: 'Rate limited' })
  async createFromUrl(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateReceiptUrlDto,
  ): Promise<ReceiptResponseDto> {
    return this.service.createFromUrl(user.sub, dto);
  }

  @CustomThrottle({ limit: 60, ttl: 60_000 })
  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: "List the caller's receipts (newest first, cursor-paginated)" })
  @ApiOkResponse({ description: 'Receipt page' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid JWT' })
  @ApiTooManyRequestsResponse({ description: 'Rate limited' })
  async list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListReceiptsQueryDto,
  ): Promise<ReceiptListResponse> {
    return this.service.list(user.sub, query);
  }

  @CustomThrottle({ limit: 60, ttl: 60_000 })
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get one receipt incl. items (uploader only)' })
  @ApiOkResponse({ description: 'Receipt', type: ReceiptResponseDto })
  @ApiNotFoundResponse({ description: 'Not found / not the uploader' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid JWT' })
  @ApiTooManyRequestsResponse({ description: 'Rate limited' })
  async getOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ReceiptResponseDto> {
    return this.service.getOne(user.sub, id);
  }

  @CustomThrottle({ limit: 60, ttl: 60_000 })
  @UseGuards(JwtAuthGuard)
  @Get(':id/file')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Stream the stored receipt file (uploader only)' })
  @ApiOkResponse({ description: 'File stream' })
  @ApiNotFoundResponse({ description: 'Not found / no file stored' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid JWT' })
  @ApiTooManyRequestsResponse({ description: 'Rate limited' })
  async downloadFile(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { stream, mimeType, sizeBytes } = await this.service.openFile(user.sub, id);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', String(sizeBytes));
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    stream.pipe(res);
  }

  @CustomThrottle({ limit: 30, ttl: 60_000 })
  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Correct extracted header fields (REVIEW only)',
    description:
      'Explicit nulls clear nullable fields. Merchant linking accepts an existing registry id; ' +
      'creating a new registry merchant happens at confirm time.',
  })
  @ApiOkResponse({ description: 'Updated receipt', type: ReceiptResponseDto })
  @ApiNotFoundResponse({ description: 'Not found / not the uploader / unknown merchant' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid JWT' })
  @ApiTooManyRequestsResponse({ description: 'Rate limited' })
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateReceiptDto,
  ): Promise<ReceiptResponseDto> {
    return this.service.update(user.sub, id, dto);
  }

  @CustomThrottle({ limit: 30, ttl: 60_000 })
  @UseGuards(JwtAuthGuard)
  @Put(':id/items')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Replace all line items (REVIEW only)',
    description:
      'Positions are assigned from array order (1-based). Categories must be visible to the ' +
      'uploader and OUT-compatible. An empty array removes every line.',
  })
  @ApiOkResponse({ description: 'Updated receipt incl. items', type: ReceiptResponseDto })
  @ApiNotFoundResponse({ description: 'Not found / not the uploader' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid JWT' })
  @ApiTooManyRequestsResponse({ description: 'Rate limited' })
  async replaceItems(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReplaceItemsDto,
  ): Promise<ReceiptResponseDto> {
    return this.service.replaceItems(user.sub, id, dto);
  }

  @CustomThrottle({ limit: 20, ttl: 60_000 })
  @UseGuards(JwtAuthGuard)
  @Post(':id/confirm')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Confirm a reviewed receipt → create its payment',
    description:
      'Creates one OUT / ONE_TIME payment from the reviewed receipt (total, currency, date, ' +
      'items) with the given primary category and attribution scopes, attaches the file as a ' +
      'receipt document, and creates the merchant in the global registry when needed. REVIEW ' +
      'only; total + currency must be set.',
  })
  @ApiOkResponse({
    description: 'Confirmed receipt (now linked to its payment)',
    type: ReceiptResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Not found / not the uploader / unknown category' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid JWT' })
  @ApiTooManyRequestsResponse({ description: 'Rate limited' })
  async confirm(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ConfirmReceiptDto,
  ): Promise<ReceiptResponseDto> {
    return this.service.confirm(user.sub, id, dto);
  }

  @CustomThrottle({ limit: 120, ttl: 60_000 })
  @UseGuards(JwtAuthGuard)
  @Post(':id/items/:itemId/match')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Confirm a product match for one line item (walkthrough)',
    description:
      'Links the item to a registry product — exactly one of productId (existing) or ' +
      'createProduct (publish + link). Records the raw spelling as an alias with the ' +
      "caller's locale and optionally overrides the item category. REVIEW or CONFIRMED.",
  })
  @ApiOkResponse({ description: 'Updated receipt incl. items', type: ReceiptResponseDto })
  @ApiNotFoundResponse({ description: 'Receipt/item/product not found' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid JWT' })
  @ApiTooManyRequestsResponse({ description: 'Rate limited' })
  async matchItem(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @Body() dto: MatchItemDto,
  ): Promise<ReceiptResponseDto> {
    return this.service.matchItem(user.sub, id, itemId, dto);
  }

  @CustomThrottle({ limit: 120, ttl: 60_000 })
  @UseGuards(JwtAuthGuard)
  @Post(':id/items/:itemId/skip-match')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Skip / unlink a line item in the walkthrough',
    description: 'Marks the item SKIPPED and clears any product link. Always resumable.',
  })
  @ApiOkResponse({ description: 'Updated receipt incl. items', type: ReceiptResponseDto })
  @ApiNotFoundResponse({ description: 'Receipt/item not found' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid JWT' })
  @ApiTooManyRequestsResponse({ description: 'Rate limited' })
  async skipItemMatch(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
  ): Promise<ReceiptResponseDto> {
    return this.service.skipItemMatch(user.sub, id, itemId);
  }

  @CustomThrottle({ limit: 20, ttl: 60_000 })
  @UseGuards(JwtAuthGuard)
  @Post(':id/retry')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Re-enqueue extraction for a FAILED receipt' })
  @ApiOkResponse({ description: 'Receipt back in the pipeline', type: ReceiptResponseDto })
  @ApiNotFoundResponse({ description: 'Not found / not the uploader' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid JWT' })
  @ApiTooManyRequestsResponse({ description: 'Rate limited' })
  async retry(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ReceiptResponseDto> {
    return this.service.retry(user.sub, id);
  }

  @CustomThrottle({ limit: 30, ttl: 60_000 })
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Delete a non-confirmed receipt (file + rows)',
    description: 'Confirmed receipts are managed through their payment (design §2.1).',
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiNotFoundResponse({ description: 'Not found / not the uploader' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid JWT' })
  @ApiTooManyRequestsResponse({ description: 'Rate limited' })
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.service.remove(user.sub, id);
  }
}
