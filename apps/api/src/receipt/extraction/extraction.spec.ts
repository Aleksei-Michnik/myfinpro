import { validateExtractionResult } from '@myfinpro/shared';
import { ConfigService } from '@nestjs/config';
import { AnthropicExtractionProvider } from './anthropic-extraction.provider';
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
import { ResilientExtractionProvider } from './resilient-extraction.provider';

// The Anthropic SDK is mocked at module level — the provider spec asserts
// the request shape without any network.
const anthropicCreateMock = jest.fn();
jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: { create: anthropicCreateMock },
  }));
});

const IMAGE_INPUT: ExtractionInput = {
  kind: 'image',
  data: Buffer.from('fake-image'),
  mimeType: 'image/jpeg',
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
    anthropic: unknown,
    openai: unknown,
  ) => ReceiptExtractionProvider;
  const factory = (
    extractionProviderFactory as unknown as {
      useFactory: FactoryFn;
    }
  ).useFactory;
  const mock = new MockExtractionProvider();
  const fakeReal = { name: 'anthropic', extract: jest.fn() };
  const fakeOpenAi = { name: 'openai', extract: jest.fn() };

  it('defaults to the bare mock provider', () => {
    const provider = factory(configWith({}), mock, fakeReal, fakeOpenAi);
    expect(provider).toBe(mock);
  });

  it('wraps real providers in the resilience decorator', () => {
    const provider = factory(
      configWith({ RECEIPT_EXTRACTION_PROVIDER: 'anthropic' }),
      mock,
      fakeReal,
      fakeOpenAi,
    );
    expect(provider).toBeInstanceOf(ResilientExtractionProvider);
    expect(provider.name).toBe('anthropic');
  });

  it('fails the boot on an unknown provider name', () => {
    expect(() =>
      factory(
        configWith({ RECEIPT_EXTRACTION_PROVIDER: 'gemini5000' }),
        mock,
        fakeReal,
        fakeOpenAi,
      ),
    ).toThrow(/Unknown RECEIPT_EXTRACTION_PROVIDER/);
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
  });

  const makeProvider = () =>
    new AnthropicExtractionProvider(
      configWith({ ANTHROPIC_API_KEY: 'sk-test', RECEIPT_EXTRACTION_MODEL: 'claude-opus-4-8' }),
    );

  it('sends the image before the prompt with json_schema structured output', async () => {
    anthropicCreateMock.mockResolvedValue(validPayload());
    const result = await makeProvider().extract(IMAGE_INPUT, CTX);

    const req = anthropicCreateMock.mock.calls[0][0];
    expect(req.model).toBe('claude-opus-4-8');
    expect(req.thinking).toEqual({ type: 'adaptive' });
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

  it('lets transport errors bubble for the resilience layer to retry', async () => {
    anthropicCreateMock.mockRejectedValue(new Error('overloaded_error'));
    await expect(makeProvider().extract(IMAGE_INPUT, CTX)).rejects.toThrow('overloaded_error');
  });
});
