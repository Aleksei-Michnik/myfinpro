import { consumeChatCompletionsStream } from './openai-sse.util';

async function* chunks(...parts: string[]): AsyncIterable<string> {
  for (const part of parts) yield part;
}

const dataLine = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;

describe('consumeChatCompletionsStream (8.26)', () => {
  it('accumulates content deltas and captures finish/usage until [DONE]', async () => {
    const deltas: string[] = [];
    const outcome = await consumeChatCompletionsStream(
      chunks(
        dataLine({ choices: [{ delta: { content: '{"merchant' } }] }),
        dataLine({ choices: [{ delta: { content: 'Name":"S"}' } }] }),
        dataLine({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
        dataLine({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 4 } }),
        'data: [DONE]\n\n',
        dataLine({ choices: [{ delta: { content: 'after-done-ignored' } }] }),
      ),
      (d) => deltas.push(d),
    );
    expect(outcome.content).toBe('{"merchantName":"S"}');
    expect(outcome.finishReason).toBe('stop');
    expect(outcome.usage).toEqual({ prompt_tokens: 10, completion_tokens: 4 });
    expect(outcome.refusal).toBeNull();
    expect(deltas).toEqual(['{"merchant', 'Name":"S"}']);
  });

  it('handles frames split across transport chunks and CRLF endings', async () => {
    const frame = dataLine({ choices: [{ delta: { content: 'hello' } }] }).replace(/\n/g, '\r\n');
    const outcome = await consumeChatCompletionsStream(
      chunks(frame.slice(0, 12), frame.slice(12), 'data: [DONE]\n'),
    );
    expect(outcome.content).toBe('hello');
  });

  it('decodes multi-byte UTF-8 split across binary chunks', async () => {
    const bytes = new TextEncoder().encode(
      dataLine({ choices: [{ delta: { content: 'חלב' } }] }) + 'data: [DONE]\n',
    );
    async function* binary(): AsyncIterable<Uint8Array> {
      yield bytes.slice(0, 20); // cuts inside a Hebrew code point
      yield bytes.slice(20);
    }
    const outcome = await consumeChatCompletionsStream(binary());
    expect(outcome.content).toBe('חלב');
  });

  it('accumulates refusal deltas and the length finish reason', async () => {
    const outcome = await consumeChatCompletionsStream(
      chunks(
        dataLine({ choices: [{ delta: { refusal: 'I cannot ' } }] }),
        dataLine({ choices: [{ delta: { refusal: 'do that' }, finish_reason: 'length' }] }),
      ),
    );
    expect(outcome.refusal).toBe('I cannot do that');
    expect(outcome.finishReason).toBe('length');
  });

  it('skips unparseable data lines and non-data frames', async () => {
    const outcome = await consumeChatCompletionsStream(
      chunks(
        ': keep-alive comment\n',
        'event: ping\n',
        'data: {broken json\n',
        dataLine({ choices: [{ delta: { content: 'ok' } }] }),
      ),
    );
    expect(outcome.content).toBe('ok');
  });
});
