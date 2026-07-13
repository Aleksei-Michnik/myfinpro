import { validateExtractionResult, type ExtractionResult } from '@myfinpro/shared';
import { Logger } from '@nestjs/common';
import {
  ExtractionFailedError,
  type ExtractionContext,
  type ExtractionInput,
  type LlmClientOptions,
  type ReceiptExtractionProvider,
} from './extraction-provider.interface';
import {
  buildExtractionPrompt,
  EXTRACTION_MAX_OUTPUT_TOKENS,
  EXTRACTION_RESULT_JSON_SCHEMA,
} from './extraction.schema';

/**
 * Phase 7, iteration 7.5 — OpenAI vision extraction (raw HTTP on purpose:
 * one endpoint, no SDK dependency for the secondary provider).
 *
 * Images ride as `image_url` data-URLs; URL snapshots as text. PDFs are NOT
 * supported on the chat-completions surface — the factory's docs steer PDF
 * workloads to the anthropic provider; here they fail permanently with a
 * clear reason. Structured output via `response_format: json_schema`
 * (strict), re-validated with the shared validator.
 *
 * Built by the module factory (env key/model) or the per-user resolver
 * (Phase 8.11) — never injected directly.
 */
export class OpenAiExtractionProvider implements ReceiptExtractionProvider {
  readonly name = 'openai';
  private readonly logger = new Logger(OpenAiExtractionProvider.name);
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(options: LlmClientOptions = {}) {
    this.apiKey = options.apiKey ?? '';
    this.model = options.model || 'gpt-4o';
    this.baseUrl = options.baseUrl || 'https://api.openai.com/v1';
  }

  async extract(input: ExtractionInput, ctx: ExtractionContext): Promise<ExtractionResult> {
    if (input.kind === 'pdf') {
      throw new ExtractionFailedError(
        "The 'openai' extraction provider does not support PDFs; use the 'anthropic' provider for PDF receipts",
      );
    }

    const userContent: unknown[] = [];
    if (input.kind === 'image') {
      userContent.push({
        type: 'image_url',
        image_url: { url: `data:${input.mimeType};base64,${input.data.toString('base64')}` },
      });
    } else {
      userContent.push({
        type: 'text',
        text: `Online receipt snapshot from ${input.sourceUrl}:\n\n${input.data.slice(0, 200_000)}`,
      });
    }
    userContent.push({ type: 'text', text: buildExtractionPrompt(ctx) });

    const started = Date.now();
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: EXTRACTION_MAX_OUTPUT_TOKENS,
        messages: [{ role: 'user', content: userContent }],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'receipt_extraction',
            strict: true,
            schema: EXTRACTION_RESULT_JSON_SCHEMA,
          },
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // 4xx (except 429) are permanent; 429/5xx bubble as retryable errors.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        throw new ExtractionFailedError(
          `OpenAI request rejected (${res.status}): ${body.slice(0, 300)}`,
        );
      }
      throw new Error(`OpenAI request failed (${res.status})`);
    }

    const payload = (await res.json()) as {
      choices?: { message?: { content?: string; refusal?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    this.logger.log(
      `openai extraction: model=${this.model} durationMs=${Date.now() - started} ` +
        `input=${payload.usage?.prompt_tokens ?? '?'}tok output=${payload.usage?.completion_tokens ?? '?'}tok`,
    );

    const message = payload.choices?.[0]?.message;
    if (message?.refusal) {
      throw new ExtractionFailedError('Provider declined to process this document');
    }
    if (!message?.content) {
      throw new ExtractionFailedError('Provider returned no content');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(message.content);
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
