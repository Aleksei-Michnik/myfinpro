import Anthropic from '@anthropic-ai/sdk';
import { validateExtractionResult, type ExtractionResult } from '@myfinpro/shared';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ExtractionFailedError,
  type ExtractionContext,
  type ExtractionInput,
  type ReceiptExtractionProvider,
} from './extraction-provider.interface';
import { buildExtractionPrompt, EXTRACTION_RESULT_JSON_SCHEMA } from './extraction.schema';

/**
 * Phase 7, iteration 7.5 — Anthropic vision extraction.
 *
 * Images ride as base64 `image` blocks, PDFs as `document` blocks, URL
 * snapshots as plain text — always before the instruction text block.
 * Structured output is enforced with `output_config.format` (json_schema)
 * and re-validated with the shared validator before returning, so schema
 * drift becomes a permanent ExtractionFailedError instead of bad rows.
 *
 * Env: ANTHROPIC_API_KEY (required), RECEIPT_EXTRACTION_MODEL
 * (default claude-opus-4-8).
 */
@Injectable()
export class AnthropicExtractionProvider implements ReceiptExtractionProvider {
  readonly name = 'anthropic';
  private readonly logger = new Logger(AnthropicExtractionProvider.name);
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(configService: ConfigService) {
    this.client = new Anthropic({ apiKey: configService.get<string>('ANTHROPIC_API_KEY') });
    this.model = configService.get<string>('RECEIPT_EXTRACTION_MODEL') || 'claude-opus-4-8';
  }

  async extract(input: ExtractionInput, ctx: ExtractionContext): Promise<ExtractionResult> {
    const content: Anthropic.ContentBlockParam[] = [];
    if (input.kind === 'image') {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: input.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data: input.data.toString('base64'),
        },
      });
    } else if (input.kind === 'pdf') {
      content.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: input.data.toString('base64'),
        },
      });
    } else {
      content.push({
        type: 'text',
        text: `Online receipt snapshot from ${input.sourceUrl}:\n\n${input.data.slice(0, 200_000)}`,
      });
    }
    content.push({ type: 'text', text: buildExtractionPrompt(ctx) });

    const started = Date.now();
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 8192,
      thinking: { type: 'adaptive' },
      output_config: {
        format: {
          type: 'json_schema',
          schema: EXTRACTION_RESULT_JSON_SCHEMA as unknown as Record<string, unknown>,
        },
      },
      messages: [{ role: 'user', content }],
    });

    this.logger.log(
      `anthropic extraction: model=${this.model} durationMs=${Date.now() - started} ` +
        `input=${response.usage.input_tokens}tok output=${response.usage.output_tokens}tok ` +
        `stop=${response.stop_reason}`,
    );

    if (response.stop_reason === 'refusal') {
      throw new ExtractionFailedError('Provider declined to process this document');
    }
    const text = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === 'text',
    )?.text;
    if (!text) {
      throw new ExtractionFailedError('Provider returned no text content');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new ExtractionFailedError('Provider returned non-JSON output', err);
    }
    const validated = validateExtractionResult(parsed);
    if (!validated.ok) {
      throw new ExtractionFailedError(
        `Provider output failed validation: ${validated.errors
          .map((e) => `${e.path}: ${e.message}`)
          .join('; ')}`,
      );
    }
    return validated.result!;
  }
}
