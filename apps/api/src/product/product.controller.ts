import { PRODUCT_IMAGE_MAX_FILE_SIZE_BYTES } from '@myfinpro/shared';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
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
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CustomThrottle } from '../common/decorators/throttle.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { PRODUCT_ERRORS } from './constants/product-errors';
import { AddAliasDto } from './dto/add-alias.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import {
  BarcodeLookupResponseDto,
  ProductPurchasesResponseDto,
  ProductResponseDto,
  type ProductListResponse,
} from './dto/product-response.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductImageService } from './product-image.service';
import { ProductService } from './product.service';

/** Minimal multipart-file shape (no @types/multer in the repo). */
interface UploadedImageFile {
  buffer: Buffer;
  size: number;
}

/**
 * Phase 8, iteration 8.2 — the product registry REST surface (design §3).
 * The registry is global; purchase-derived fields are caller-scoped.
 */
@ApiTags('Products')
@Controller('products')
export class ProductController {
  constructor(
    private readonly service: ProductService,
    private readonly images: ProductImageService,
    private readonly prisma: PrismaService,
  ) {}

  @CustomThrottle({ limit: 60, ttl: 60_000 })
  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Search the registry / list purchased products',
    description:
      'With ?search: ranked global-registry matches in any recorded language (or a barcode). ' +
      "Without: the caller's purchased products, newest purchase first, cursor-paginated.",
  })
  @ApiOkResponse({ description: 'Product page' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid JWT' })
  @ApiTooManyRequestsResponse({ description: 'Rate limited' })
  async list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListProductsQueryDto,
  ): Promise<ProductListResponse> {
    return this.service.list(user.sub, query);
  }

  @CustomThrottle({ limit: 30, ttl: 60_000 })
  @UseGuards(JwtAuthGuard)
  @Get('barcode/:code')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Resolve a barcode',
    description:
      'Local registry first; unknown codes fall through to Open Food Facts for a create-form ' +
      'prefill. OFF being down degrades to manual entry (offStatus=unavailable) — never an error.',
  })
  @ApiOkResponse({ description: 'Lookup result', type: BarcodeLookupResponseDto })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid JWT' })
  @ApiTooManyRequestsResponse({ description: 'Rate limited' })
  async lookupBarcode(
    @CurrentUser() user: JwtPayload,
    @Param('code') code: string,
  ): Promise<BarcodeLookupResponseDto> {
    return this.service.lookupBarcode(user.sub, code);
  }

  @CustomThrottle({ limit: 60, ttl: 60_000 })
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get one product (aliases + caller-scoped stats)' })
  @ApiOkResponse({ description: 'Product', type: ProductResponseDto })
  @ApiNotFoundResponse({ description: 'Not found' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid JWT' })
  @ApiTooManyRequestsResponse({ description: 'Rate limited' })
  async getOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ProductResponseDto> {
    return this.service.getOne(user.sub, id);
  }

  @CustomThrottle({ limit: 60, ttl: 60_000 })
  @UseGuards(JwtAuthGuard)
  @Get(':id/purchases')
  @ApiBearerAuth()
  @ApiOperation({
    summary: "The caller's purchase history for a product",
    description:
      'Confirmed receipts only, newest first, with per-merchant price aggregates. Never ' +
      "includes other users' purchases (design §1.1).",
  })
  @ApiOkResponse({
    description: 'Purchases + per-merchant prices',
    type: ProductPurchasesResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Not found' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid JWT' })
  @ApiTooManyRequestsResponse({ description: 'Rate limited' })
  async purchases(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ProductPurchasesResponseDto> {
    return this.service.purchases(user.sub, id);
  }

  @CustomThrottle({ limit: 30, ttl: 60_000 })
  @UseGuards(JwtAuthGuard)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a product in the global registry',
    description:
      'Barcode is GTIN-checksum-validated and globally unique. The canonical name is seeded ' +
      'as the first alias. Audited.',
  })
  @ApiOkResponse({ description: 'Created product', type: ProductResponseDto })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid JWT' })
  @ApiTooManyRequestsResponse({ description: 'Rate limited' })
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateProductDto,
  ): Promise<ProductResponseDto> {
    return this.service.create(user.sub, dto);
  }

  @CustomThrottle({ limit: 30, ttl: 60_000 })
  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update a registry product',
    description: 'Explicit nulls clear brand / barcode / defaultCategoryId. Audited.',
  })
  @ApiOkResponse({ description: 'Updated product', type: ProductResponseDto })
  @ApiNotFoundResponse({ description: 'Not found' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid JWT' })
  @ApiTooManyRequestsResponse({ description: 'Rate limited' })
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductResponseDto> {
    return this.service.update(user.sub, id, dto);
  }

  @CustomThrottle({ limit: 30, ttl: 60_000 })
  @UseGuards(JwtAuthGuard)
  @Post(':id/aliases')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Add / confirm an alias',
    description: 'Upserts on the normalized spelling; existing aliases get their count bumped.',
  })
  @ApiOkResponse({ description: 'Product incl. aliases', type: ProductResponseDto })
  @ApiNotFoundResponse({ description: 'Not found' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid JWT' })
  @ApiTooManyRequestsResponse({ description: 'Rate limited' })
  async addAlias(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AddAliasDto,
  ): Promise<ProductResponseDto> {
    return this.service.addAlias(user.sub, id, dto);
  }

  @CustomThrottle({ limit: 10, ttl: 60_000 })
  @UseGuards(JwtAuthGuard)
  @Post(':id/image')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: PRODUCT_IMAGE_MAX_FILE_SIZE_BYTES + 1024 * 1024 },
    }),
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
    summary: 'Upload the product image (processed in background)',
    description:
      'JPEG / PNG / WebP / HEIC up to 10MB. Staged and re-encoded asynchronously to a 512px ' +
      'WebP with metadata stripped; the product carries the new image once the job completes.',
  })
  @ApiOkResponse({ description: 'Queued' })
  @ApiPayloadTooLargeResponse({ description: 'File exceeds the hard multipart cap' })
  @ApiNotFoundResponse({ description: 'Not found' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid JWT' })
  @ApiTooManyRequestsResponse({ description: 'Rate limited' })
  async uploadImage(
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile() file: UploadedImageFile | undefined,
  ): Promise<{ queued: boolean }> {
    if (!file || !file.buffer) {
      throw new BadRequestException({
        message: "Multipart field 'file' is required",
        errorCode: PRODUCT_ERRORS.PRODUCT_INVALID_IMAGE,
      });
    }
    const product = await this.prisma.product.findUnique({ where: { id }, select: { id: true } });
    if (!product) {
      throw new BadRequestException({
        message: 'Product not found',
        errorCode: PRODUCT_ERRORS.PRODUCT_NOT_FOUND,
      });
    }
    await this.images.enqueueUpload(id, file.buffer);
    return { queued: true };
  }

  @CustomThrottle({ limit: 120, ttl: 60_000 })
  @UseGuards(JwtAuthGuard)
  @Get(':id/image')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Stream the processed product image',
    description:
      'WebP, ≤512px. The image_ref is immutable per version, so the ETag enables long-lived ' +
      'revalidation (304) while re-uploads bust via ?v=.',
  })
  @ApiOkResponse({ description: 'Image stream' })
  @ApiNotFoundResponse({ description: 'Not found / no image' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid JWT' })
  @ApiTooManyRequestsResponse({ description: 'Rate limited' })
  async downloadImage(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      select: { imageRef: true },
    });
    if (!product?.imageRef) {
      res.status(HttpStatus.NOT_FOUND).json({
        message: 'Product image not found',
        errorCode: PRODUCT_ERRORS.PRODUCT_NOT_FOUND,
      });
      return;
    }
    const etag = `"${product.imageRef.split('/').pop()}"`;
    if (req.headers['if-none-match'] === etag) {
      res.status(HttpStatus.NOT_MODIFIED).end();
      return;
    }
    const { stream, sizeBytes } = await this.images.openStream(product.imageRef);
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Content-Length', String(sizeBytes));
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    stream.pipe(res);
  }
}
