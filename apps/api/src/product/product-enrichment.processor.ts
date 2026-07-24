import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { PRODUCT_ENRICHMENTS_QUEUE } from '../queue/queue.constants';
import { ProductEnrichmentService, type EnrichmentSummary } from './product-enrichment.service';

/**
 * Nightly OFF-enrichment worker (design §1.4) — the queue's job scheduler
 * fires once a day; the sweep itself lives in ProductEnrichmentService.
 */
@Processor(PRODUCT_ENRICHMENTS_QUEUE)
export class ProductEnrichmentProcessor extends WorkerHost {
  private readonly logger = new Logger(ProductEnrichmentProcessor.name);

  constructor(private readonly enrichment: ProductEnrichmentService) {
    super();
  }

  async process(): Promise<EnrichmentSummary> {
    this.logger.log('Nightly product enrichment run starting');
    return this.enrichment.enrichUnchecked();
  }
}
