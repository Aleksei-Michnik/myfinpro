import { validateExtractionResult } from '@myfinpro/shared';
import { ConfigService } from '@nestjs/config';
import { AnthropicExtractionProvider } from './anthropic-extraction.provider';
import { mergeContinuationItems, salvageCompleteItems } from './extraction-continuation.util';
import {
  extractionProviderFactory,
  SUPPORTED_EXTRACTION_PROVIDERS,
} from './extraction-provider.factory';
import {
  ExtractionFailedError,
  type ExtractionInput,
  type ReceiptExtractionProvider,
} from './extraction-provider.interface';
import { buildExtractionPrompt } from './extraction.schema';
import { MockExtractionProvider } from './mock-extraction.provider';
import { OpenAiExtractionProvider } from './openai-extraction.provider';
import { ResilientExtractionProvider } from './resilient-extraction.provider';

// The Anthropic SDK is mocked at module level — the provider spec asserts
// the request shape without any network. The provider streams and awaits
// `finalMessage()` (8.21), so the mock resolves/rejects through that path;
// `APIError` mirrors the SDK's static error class for instanceof checks.
// 8.26: scripted raw events in `anthropicStreamEvents` replay to
// `.on('streamEvent')` subscribers before finalMessage resolves.
const anthropicCreateMock = jest.fn();
const anthropicStreamEvents: unknown[] = [];
jest.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  }
  const ctor = jest.fn().mockImplementation(() => ({
    messages: {
      stream: (req: unknown) => {
        const listeners: ((event: unknown) => void)[] = [];
        return {
          on: (name: string, fn: (event: unknown) => void) => {
            if (name === 'streamEvent') listeners.push(fn);
          },
          finalMessage: () => {
            for (const event of anthropicStreamEvents) {
              for (const fn of listeners) fn(event);
            }
            return anthropicCreateMock(req);
          },
        };
      },
    },
  }));
  return Object.assign(ctor, { APIError });
});

const IMAGE_INPUT: ExtractionInput = {
  kind: 'image',
  pages: [{ data: Buffer.from('fake-image'), mimeType: 'image/jpeg' }],
};
const CTX = {
  categories: [{ id: 'cat-1', name: 'Groceries' }],
  products: [{ id: 'prod-1', name: 'Milk 3%', brand: 'Tnuva' }],
};

const configWith = (values: Record<string, string>) =>
  ({
    get: (key: string, def?: string) => values[key] ?? def,
  }) as unknown as ConfigService;

describe('MockExtractionProvider', () => {
  it('returns a deterministic result that passes the shared validator and reconciles', async () => {
    const provider = new MockExtractionProvider();
    const result = await provider.extract(IMAGE_INPUT, CTX);
    const validated = validateExtractionResult(result);
    expect(validated.ok).toBe(true);
    // Σ items − receipt discount === total (clean fixture for the review UI).
    const itemsSum = result.items.reduce((s, i) => s + i.totalCents, 0);
    expect(itemsSum - (result.discountCents ?? 0)).toBe(result.totalCents);
    // Suggested categories come from the candidate list.
    expect(result.items[0].suggestedCategoryId).toBe('cat-1');
    // Phase 8: the LLM-stage product suggestion comes from the known list.
    expect(result.items[0].suggestedProductId).toBe('prod-1');
  });

  it('suggests null categories/products when no candidates are provided', async () => {
    const provider = new MockExtractionProvider();
    const result = await provider.extract(IMAGE_INPUT, { categories: [], products: [] });
    expect(result.items.every((i) => i.suggestedCategoryId === null)).toBe(true);
    expect(result.items.every((i) => i.suggestedProductId === null)).toBe(true);
  });
});

describe('buildExtractionPrompt', () => {
  it('lists the candidates and pins the integer-cents rule', () => {
    const prompt = buildExtractionPrompt({
      categories: CTX.categories,
      products: CTX.products,
      locale: 'he-IL',
    });
    expect(prompt).toContain('- cat-1: Groceries');
    expect(prompt).toContain('- prod-1: Milk 3% (Tnuva)');
    expect(prompt).toContain('DIFFERENT language');
    expect(prompt).toContain('INTEGER cents');
    expect(prompt).toContain('he-IL');
  });

  it('degrades to null-candidate guidance without candidates', () => {
    const prompt = buildExtractionPrompt({ categories: [], products: [] });
    expect(prompt).toContain('no candidates provided');
    expect(prompt).toContain('no known products');
  });
});

describe('extractionProviderFactory', () => {
  type FactoryFn = (
    config: ConfigService,
    mock: MockExtractionProvider,
  ) => ReceiptExtractionProvider;
  const factory = (
    extractionProviderFactory as unknown as {
      useFactory: FactoryFn;
    }
  ).useFactory;
  const mock = new MockExtractionProvider();

  it('defaults to the bare mock provider', () => {
    const provider = factory(configWith({}), mock);
    expect(provider).toBe(mock);
  });

  it('wraps real providers in the resilience decorator', () => {
    const provider = factory(
      configWith({ RECEIPT_EXTRACTION_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-test' }),
      mock,
    );
    expect(provider).toBeInstanceOf(ResilientExtractionProvider);
    expect(provider.name).toBe('anthropic');
  });

  it('fails the boot on an unknown provider name', () => {
    expect(() => factory(configWith({ RECEIPT_EXTRACTION_PROVIDER: 'gemini5000' }), mock)).toThrow(
      /Unknown RECEIPT_EXTRACTION_PROVIDER/,
    );
    expect(SUPPORTED_EXTRACTION_PROVIDERS).toEqual(['mock', 'anthropic', 'openai']);
  });
});

describe('ResilientExtractionProvider', () => {
  const opts = { attempts: 3, baseDelayMs: 1, breakerThreshold: 2, breakerCooldownMs: 50 };
  const okResult = new MockExtractionProvider().extract(IMAGE_INPUT, CTX);

  it('retries transient failures and succeeds', async () => {
    const inner = {
      name: 'flaky',
      extract: jest
        .fn()
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockRejectedValueOnce(new Error('529'))
        .mockImplementation(() => okResult),
    };
    const provider = new ResilientExtractionProvider(inner, opts);
    await expect(provider.extract(IMAGE_INPUT, CTX)).resolves.toMatchObject({
      merchantName: 'Mock Grocery',
    });
    expect(inner.extract).toHaveBeenCalledTimes(3);
  });

  it('does not retry permanent ExtractionFailedError', async () => {
    const inner = {
      name: 'strict',
      extract: jest.fn().mockRejectedValue(new ExtractionFailedError('bad pdf')),
    };
    const provider = new ResilientExtractionProvider(inner, opts);
    await expect(provider.extract(IMAGE_INPUT, CTX)).rejects.toThrow(ExtractionFailedError);
    expect(inner.extract).toHaveBeenCalledTimes(1);
  });

  it('opens the breaker after consecutive failed calls, then half-open probe recovers', async () => {
    const inner = { name: 'down', extract: jest.fn().mockRejectedValue(new Error('boom')) };
    const provider = new ResilientExtractionProvider(inner, opts);

    await expect(provider.extract(IMAGE_INPUT, CTX)).rejects.toThrow('boom'); // failure 1 (3 attempts)
    await expect(provider.extract(IMAGE_INPUT, CTX)).rejects.toThrow('boom'); // failure 2 → OPEN
    expect(inner.extract).toHaveBeenCalledTimes(6);

    // While open: fail fast, inner not touched.
    await expect(provider.extract(IMAGE_INPUT, CTX)).rejects.toThrow(/circuit breaker is open/);
    expect(inner.extract).toHaveBeenCalledTimes(6);

    // After cooldown: half-open probe goes through and closes on success.
    await new Promise((r) => setTimeout(r, 60));
    inner.extract.mockImplementation(() => okResult);
    await expect(provider.extract(IMAGE_INPUT, CTX)).resolves.toBeDefined();
    await expect(provider.extract(IMAGE_INPUT, CTX)).resolves.toBeDefined();
  });
});

describe('AnthropicExtractionProvider', () => {
  const validPayload = () => ({
    stop_reason: 'end_turn',
    usage: { input_tokens: 1000, output_tokens: 200 },
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          merchantName: 'Shufersal',
          purchasedAt: '2026-07-01T10:00:00Z',
          currency: 'ils',
          totalCents: 880,
          discountCents: 0,
          items: [
            {
              rawName: 'חלב 3%',
              quantity: 2,
              unitPriceCents: 440,
              discountCents: 0,
              totalCents: 880,
              suggestedCategoryId: 'cat-1',
            },
          ],
          confidence: 'high',
          notes: null,
        }),
      },
    ],
  });

  beforeEach(() => {
    anthropicCreateMock.mockReset();
    anthropicStreamEvents.length = 0;
  });

  const makeProvider = () =>
    new AnthropicExtractionProvider({ apiKey: 'sk-test', model: 'claude-opus-4-8' });

  it('sends the image before the prompt with json_schema structured output', async () => {
    anthropicCreateMock.mockResolvedValue(validPayload());
    const result = await makeProvider().extract(IMAGE_INPUT, CTX);

    const req = anthropicCreateMock.mock.calls[0][0];
    expect(req.model).toBe('claude-opus-4-8');
    // 8.26 — summarized display so the thinking stream is visible.
    expect(req.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(req.output_config.format.type).toBe('json_schema');
    expect(req.output_config.format.schema.properties.items).toBeDefined();
    const [first, second] = req.messages[0].content;
    expect(first.type).toBe('image');
    expect(first.source.media_type).toBe('image/jpeg');
    expect(second.type).toBe('text');
    expect(second.text).toContain('- cat-1: Groceries');

    // Normalization applied via the shared validator.
    expect(result.currency).toBe('ILS');
    expect(result.items[0].rawName).toBe('חלב 3%');
  });

  it('sends PDFs as document blocks', async () => {
    anthropicCreateMock.mockResolvedValue(validPayload());
    await makeProvider().extract({ kind: 'pdf', data: Buffer.from('pdf') }, CTX);
    const [first] = anthropicCreateMock.mock.calls[0][0].messages[0].content;
    expect(first.type).toBe('document');
    expect(first.source.media_type).toBe('application/pdf');
  });

  it('maps refusal, non-JSON, and schema-invalid outputs to permanent failures', async () => {
    anthropicCreateMock.mockResolvedValueOnce({
      stop_reason: 'refusal',
      usage: { input_tokens: 1, output_tokens: 0 },
      content: [],
    });
    await expect(makeProvider().extract(IMAGE_INPUT, CTX)).rejects.toThrow(ExtractionFailedError);

    anthropicCreateMock.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: 'text', text: 'not json at all' }],
    });
    await expect(makeProvider().extract(IMAGE_INPUT, CTX)).rejects.toThrow(/non-JSON/);

    const bad = validPayload();
    const parsed = JSON.parse((bad.content[0] as { text: string }).text);
    parsed.totalCents = 8.8; // float cents — schema drift
    (bad.content[0] as { text: string }).text = JSON.stringify(parsed);
    anthropicCreateMock.mockResolvedValueOnce(bad);
    await expect(makeProvider().extract(IMAGE_INPUT, CTX)).rejects.toThrow(/failed validation/);
  });

  it('fails truncation with nothing salvageable as its own permanent error', async () => {
    anthropicCreateMock.mockResolvedValueOnce({
      stop_reason: 'max_tokens',
      usage: { input_tokens: 1000, output_tokens: 64000 },
      content: [{ type: 'text', text: '{"merchantName": "Shufe' }],
    });
    await expect(makeProvider().extract(IMAGE_INPUT, CTX)).rejects.toThrow(/salvaged/);
  });

  it('chunks a truncated pass: salvages complete items and continues after them', async () => {
    const item = (rawName: string) => ({
      rawName,
      quantity: 1,
      unitPriceCents: 440,
      discountCents: 0,
      totalCents: 440,
      suggestedCategoryId: null,
      suggestedProductId: null,
    });
    // Pass 1 hits the ceiling mid-item: one complete item + one cut off.
    const truncated =
      `{"merchantName":"Shufersal","purchasedAt":null,"currency":"ILS",` +
      `"totalCents":880,"discountCents":0,"items":[${JSON.stringify(item('לחם'))},{"rawName":"חצ`;
    anthropicCreateMock
      .mockResolvedValueOnce({
        stop_reason: 'max_tokens',
        usage: { input_tokens: 1000, output_tokens: 64000 },
        content: [{ type: 'text', text: truncated }],
      })
      .mockResolvedValueOnce(validPayload());

    const result = await makeProvider().extract(IMAGE_INPUT, CTX);
    // Salvaged chunk-1 item precedes the continuation pass's items.
    expect(result.items.map((i) => i.rawName)).toEqual(['לחם', 'חלב 3%']);

    // The second call's prompt carries the continuation anchor.
    const secondReq = anthropicCreateMock.mock.calls[1][0] as {
      messages: { content: { type: string; text?: string }[] }[];
    };
    const promptBlock = secondReq.messages[0].content.at(-1);
    expect(promptBlock?.text).toContain('CONTINUATION');
    expect(promptBlock?.text).toContain('"לחם"');
  });

  it('streams thinking and text deltas into onProgress (8.26)', async () => {
    anthropicCreateMock.mockResolvedValue(validPayload());
    anthropicStreamEvents.push(
      {
        type: 'content_block_delta',
        delta: { type: 'thinking_delta', thinking: 'Scanning the header. ' },
      },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: '{"items":[{"rawName"' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: ':"a"},{"rawName":"b"}' } },
    );
    const updates: { stage: string; thought?: string; itemsSoFar?: number }[] = [];
    await makeProvider().extract(IMAGE_INPUT, { ...CTX, onProgress: (u) => updates.push(u) });

    expect(updates[0]).toEqual({ stage: 'processing' });
    expect(updates).toContainEqual({ stage: 'thinking', thought: 'Scanning the header. ' });
    // Running item count over the accumulated JSON, boundary-safe.
    expect(updates.filter((u) => u.stage === 'generating').map((u) => u.itemsSoFar)).toEqual([
      1, 2,
    ]);
  });

  it('emits a continuing progress update at each chunk boundary (8.26)', async () => {
    const truncated =
      `{"merchantName":"Shufersal","purchasedAt":null,"currency":"ILS",` +
      `"totalCents":880,"discountCents":0,"items":[{"rawName":"לחם","quantity":1,` +
      `"unitPriceCents":440,"discountCents":0,"totalCents":440,` +
      `"suggestedCategoryId":null,"suggestedProductId":null},{"rawName":"חצ`;
    anthropicCreateMock
      .mockResolvedValueOnce({
        stop_reason: 'max_tokens',
        usage: { input_tokens: 1000, output_tokens: 64000 },
        content: [{ type: 'text', text: truncated }],
      })
      .mockResolvedValueOnce(validPayload());
    const updates: { stage: string; pass?: number }[] = [];
    await makeProvider().extract(IMAGE_INPUT, { ...CTX, onProgress: (u) => updates.push(u) });
    expect(updates).toContainEqual({ stage: 'continuing', pass: 1, itemsSoFar: 1 });
  });

  it('maps 4xx API rejections (e.g. unsupported thinking mode) to permanent failures', async () => {
    const Anthropic = jest.requireMock('@anthropic-ai/sdk') as {
      APIError: new (status: number, message: string) => Error;
    };
    anthropicCreateMock.mockRejectedValueOnce(
      new Anthropic.APIError(400, 'adaptive thinking is not supported on this model'),
    );
    await expect(makeProvider().extract(IMAGE_INPUT, CTX)).rejects.toThrow(ExtractionFailedError);

    // 429 stays retryable — it rides the resilience layer's backoff.
    anthropicCreateMock.mockRejectedValueOnce(new Anthropic.APIError(429, 'rate limited'));
    const err: unknown = await makeProvider()
      .extract(IMAGE_INPUT, CTX)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ExtractionFailedError);
    expect((err as Error).message).toBe('rate limited');
  });

  it('lets transport errors bubble for the resilience layer to retry', async () => {
    anthropicCreateMock.mockRejectedValue(new Error('overloaded_error'));
    await expect(makeProvider().extract(IMAGE_INPUT, CTX)).rejects.toThrow('overloaded_error');
  });
});

describe('OpenAiExtractionProvider (8.26 streaming)', () => {
  const validJson = JSON.stringify({
    merchantName: 'Shufersal',
    purchasedAt: null,
    currency: 'ILS',
    totalCents: 440,
    discountCents: 0,
    items: [
      {
        rawName: 'לחם',
        quantity: 1,
        unitPriceCents: 440,
        discountCents: 0,
        totalCents: 440,
        suggestedCategoryId: null,
        suggestedProductId: null,
      },
    ],
    confidence: 'high',
    notes: null,
  });

  const sseBody = (content: string) => {
    const mid = Math.floor(content.length / 2);
    return [
      `data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(0, mid) } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(mid) } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}`,
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 9, completion_tokens: 5 } })}`,
      'data: [DONE]',
      '',
    ].join('\n');
  };

  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('streams the completion and drives generating progress', async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response(sseBody(validJson)));
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new OpenAiExtractionProvider({ apiKey: 'sk-test', model: 'gpt-5.6' });
    const updates: { stage: string; itemsSoFar?: number }[] = [];
    const result = await provider.extract(IMAGE_INPUT, {
      ...CTX,
      onProgress: (u) => updates.push(u),
    });

    expect(result.items.map((i) => i.rawName)).toEqual(['לחם']);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as {
      stream: boolean;
      stream_options: { include_usage: boolean };
    };
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(updates[0]).toEqual({ stage: 'processing' });
    expect(updates.at(-1)).toEqual({ stage: 'generating', itemsSoFar: 1 });
  });

  it('maps streamed refusals to a permanent failure', async () => {
    const body = [
      `data: ${JSON.stringify({ choices: [{ delta: { refusal: 'no' }, finish_reason: 'stop' }] })}`,
      'data: [DONE]',
      '',
    ].join('\n');
    global.fetch = jest.fn().mockResolvedValue(new Response(body)) as unknown as typeof fetch;
    const provider = new OpenAiExtractionProvider({ apiKey: 'sk-test' });
    await expect(provider.extract(IMAGE_INPUT, CTX)).rejects.toThrow(ExtractionFailedError);
  });
});

describe('extraction continuation utils (8.21)', () => {
  it('salvages only complete item objects from truncated JSON', () => {
    const truncated =
      '{"merchantName":"S","items":[{"rawName":"a","totalCents":100},' +
      '{"rawName":"b","nested":{"x":1}},{"rawName":"cut-off","total';
    const items = salvageCompleteItems(truncated);
    expect(items.map((i) => i.rawName)).toEqual(['a', 'b']);
  });

  it('handles braces and escaped quotes inside item strings', () => {
    const truncated = '{"items":[{"rawName":"weird {\\" name"},{"rawName":"tail';
    expect(salvageCompleteItems(truncated).map((i) => i.rawName)).toEqual(['weird {" name']);
  });

  it('returns nothing when the items array never started', () => {
    expect(salvageCompleteItems('{"merchantName":"Shufe')).toEqual([]);
  });

  it('stops at the closed items array (no salvage from complete payloads)', () => {
    const complete = '{"items":[{"rawName":"a"}],"confidence":"high"}';
    expect(salvageCompleteItems(complete).map((i) => i.rawName)).toEqual(['a']);
  });

  it('merges salvaged items in front of the final pass items', () => {
    const merged = mergeContinuationItems({ merchantName: 'S', items: [{ rawName: 'c' }] }, [
      { rawName: 'a' },
      { rawName: 'b' },
    ]) as { items: { rawName: string }[] };
    expect(merged.items.map((i) => i.rawName)).toEqual(['a', 'b', 'c']);
  });
});
