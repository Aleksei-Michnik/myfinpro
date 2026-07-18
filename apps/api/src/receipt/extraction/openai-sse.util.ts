/**
 * Phase 8.26 — minimal SSE consumer for the OpenAI chat-completions stream
 * (design §4.3). Kept transport-agnostic (any async byte/string iterable)
 * so unit tests feed fixture chunks without a socket.
 */

interface ChatCompletionChunk {
  choices?: {
    delta?: { content?: string; refusal?: string };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

export interface OpenAiStreamOutcome {
  /** Accumulated assistant text (the JSON document). */
  content: string;
  /** Non-empty when the model refused. */
  refusal: string | null;
  /** e.g. 'stop' | 'length' — null if the stream ended without one. */
  finishReason: string | null;
  /** From the trailing `stream_options.include_usage` chunk. */
  usage: { prompt_tokens?: number; completion_tokens?: number } | null;
}

/**
 * Consume a `data:`-framed SSE body until `[DONE]` (or EOF), invoking
 * `onContentDelta` for every content fragment. Unparseable data lines are
 * skipped — the caller validates the accumulated JSON afterwards anyway.
 */
export async function consumeChatCompletionsStream(
  body: AsyncIterable<Uint8Array | string>,
  onContentDelta?: (delta: string) => void,
): Promise<OpenAiStreamOutcome> {
  const decoder = new TextDecoder();
  const outcome: OpenAiStreamOutcome = {
    content: '',
    refusal: null,
    finishReason: null,
    usage: null,
  };

  let buffer = '';
  const handleLine = (line: string): boolean => {
    if (!line.startsWith('data:')) return false;
    const data = line.slice(5).trim();
    if (data === '[DONE]') return true;
    let chunk: ChatCompletionChunk;
    try {
      chunk = JSON.parse(data) as ChatCompletionChunk;
    } catch {
      return false;
    }
    const choice = chunk.choices?.[0];
    if (choice?.delta?.content) {
      outcome.content += choice.delta.content;
      onContentDelta?.(choice.delta.content);
    }
    if (choice?.delta?.refusal) {
      outcome.refusal = (outcome.refusal ?? '') + choice.delta.refusal;
    }
    if (choice?.finish_reason) {
      outcome.finishReason = choice.finish_reason;
    }
    if (chunk.usage) {
      outcome.usage = chunk.usage;
    }
    return false;
  };

  for await (const raw of body) {
    buffer += typeof raw === 'string' ? raw : decoder.decode(raw, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      if (handleLine(line)) return outcome;
    }
  }
  if (buffer.length > 0) handleLine(buffer.replace(/\r$/, ''));
  return outcome;
}
