import { Module } from '@nestjs/common';
import { JwtConfigModule } from '../auth/jwt-config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { OpenFoodFactsService } from './open-food-facts.service';
import { ProductImageProcessor } from './product-image.processor';
import { ProductImageService } from './product-image.service';
import { ProductMatchingService } from './product-matching.service';
import { ProductController } from './product.controller';
import { ProductService } from './product.service';

/**
 * Phase 8 — Product Catalog, Matching & Barcode module.
 *
 * Imported by ReceiptModule: the extraction worker feeds the staged matcher
 * (8.3) and the walkthrough endpoints (8.4/8.5) write to the registry, so
 * the product surface rides the receipt module's import into the app graph.
 * The `product-images` queue itself comes from the global QueueModule.
 */
@Module({
  // JwtConfigModule backs CookieOrBearerAuthGuard on the <img>-consumed
  // picture endpoints (8.25-hotfix — plain image tags carry no Bearer).
  imports: [PrismaModule, JwtConfigModule],
  providers: [
    ProductService,
    ProductMatchingService,
    OpenFoodFactsService,
    ProductImageService,
    ProductImageProcessor,
  ],
  controllers: [ProductController],
  exports: [ProductService, ProductMatchingService, ProductImageService],
})
export class ProductModule {}
