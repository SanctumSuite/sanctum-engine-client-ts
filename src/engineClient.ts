/**
 * Sanctum Engine client — TypeScript/JavaScript.
 *
 * All Sanctum Suite apps (Node or browser) call Engine through this module
 * instead of hitting Ollama/OpenRouter directly. Keep the API surface in
 * sync with the Python client at
 * https://github.com/SanctumSuite/sanctum-engine/tree/main/client
 */
import { EngineError } from "./types.js";
import type {
  ClientOptions,
  EmbedResponse,
  OnCompleteCallback,
  StreamEvent,
  TaskRequest,
  TaskResponse,
} from "./types.js";

export const ENGINE_URL: string =
  (typeof process !== "undefined" && process.env?.ENGINE_URL) ||
  "http://localhost:8100";

// `fetch` + AbortSignal only gives us a single overall timeout, not separate
// connect + read budgets. We expose a single `readTimeoutMs` on ClientOptions
// that caps the whole request.
const DEFAULT_READ_TIMEOUT_MS = Number(
  (typeof process !== "undefined" && process.env?.ENGINE_TIMEOUT_READ_MS) || 120000,
);

function resolveBaseUrl(opts?: ClientOptions): string {
  return opts?.baseUrl ?? ENGINE_URL;
}

/** Abort-after-N-ms helper; returns { signal, cancel } for cleanup. */
function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(id) };
}

/** Is Engine reachable? Swallows errors, returns a boolean. */
export async function engineHealth(opts?: ClientOptions): Promise<boolean> {
  const url = resolveBaseUrl(opts);
  const { signal, cancel } = withTimeout(5000);
  try {
    const resp = await fetch(`${url}/health`, { signal });
    return resp.ok;
  } catch {
    return false;
  } finally {
    cancel();
  }
}

export interface RunTaskOptions extends ClientOptions {
  /** Optional callback receiving Engine's full `meta` dict on success.
   *  Use for cost tracking, telemetry, per-task logging. */
  onComplete?: OnCompleteCallback;
}

/**
 * Run a single task on Engine. Returns `{ result, latencyMs }`.
 *
 * Throws `EngineError` on status=error or transport failure.
 */
export async function runTask<T = unknown>(
  req: TaskRequest,
  opts?: RunTaskOptions,
): Promise<{ result: T; latencyMs: number }> {
  const url = resolveBaseUrl(opts);
  const readTimeoutMs = opts?.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
  const { signal, cancel } = withTimeout(readTimeoutMs);
  const started = performance.now();

  let data: TaskResponse<T>;
  try {
    const resp = await fetch(`${url}/task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task_type: req.task_type,
        model_preference: req.model_preference ?? "fast",
        system_prompt: req.system_prompt ?? "",
        user_prompt: req.user_prompt ?? "",
        max_retries: req.max_retries ?? 3,
        ...(req.messages !== undefined && { messages: req.messages }),
        ...(req.model !== undefined && { model: req.model }),
        ...(req.output_schema !== undefined && { output_schema: req.output_schema }),
        ...(req.context_budget !== undefined && { context_budget: req.context_budget }),
        ...(req.temperature !== undefined && { temperature: req.temperature }),
        ...(req.max_tokens !== undefined && { max_tokens: req.max_tokens }),
        ...(req.chunking !== undefined && { chunking: req.chunking }),
        ...(req.runtime !== undefined && { runtime: req.runtime }),
      }),
      signal,
    });
    if (!resp.ok) {
      throw new EngineError("HTTP_ERROR", `${resp.status} ${resp.statusText}`);
    }
    data = (await resp.json()) as TaskResponse<T>;
  } finally {
    cancel();
  }

  const latencyMs = Math.round(performance.now() - started);

  if (data.status !== "success") {
    const err = data.error ?? { code: "UNKNOWN", message: "" };
    throw new EngineError(err.code, err.message, err.attempts ?? []);
  }

  if (opts?.onComplete) {
    try {
      await opts.onComplete(data.meta);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("sanctum-engine-client: onComplete callback threw:", e);
    }
  }

  return { result: data.result as T, latencyMs };
}

/**
 * Translate `text` from one language to another via Engine.
 * Mirrors the Python client's `translate()` signature.
 */
export async function translate(
  text: string,
  sourceLangLabel: string,
  targetLangLabel: string,
  opts?: RunTaskOptions & { model?: string },
): Promise<{ result: string; latencyMs: number }> {
  const systemPrompt =
    `Translate the following text from ${sourceLangLabel} to ${targetLangLabel}. ` +
    `Output ONLY the translation — no commentary, no quotes, no language labels.`;
  return runTask<string>(
    {
      task_type: "generate_text",
      model_preference: "translation",
      system_prompt: systemPrompt,
      user_prompt: text,
      model: opts?.model,
      max_retries: 2,
    },
    opts,
  );
}

/** Embed a batch of texts. Returns a list of vectors (one per input text). */
export async function embedTexts(
  texts: string[],
  model?: string,
  opts?: ClientOptions,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const url = resolveBaseUrl(opts);
  const readTimeoutMs = opts?.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
  const { signal, cancel } = withTimeout(readTimeoutMs);
  try {
    const resp = await fetch(`${url}/task/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts, ...(model !== undefined && { model }) }),
      signal,
    });
    if (!resp.ok) {
      throw new EngineError("HTTP_ERROR", `${resp.status} ${resp.statusText}`);
    }
    const data = (await resp.json()) as EmbedResponse;
    return data.embeddings ?? [];
  } finally {
    cancel();
  }
}

/** Embed a single string. Convenience wrapper over `embedTexts`. */
export async function embedQuery(
  text: string,
  model?: string,
  opts?: ClientOptions,
): Promise<number[]> {
  const vectors = await embedTexts([text], model, opts);
  return vectors[0] ?? [];
}

/**
 * Stream a task from Engine. Returns an async iterator yielding `StreamEvent`s:
 *   - { type: "delta", content: "..." }   — generated text chunk
 *   - { type: "done",  meta: { ... } }    — stream finished
 *   - { type: "error", code: "...", message: "..." }
 *
 * Only `task_type: "generate_text"` is supported in streaming mode. Consumers
 * typically concatenate delta.content into a string and use the done event's
 * meta for tokens/latency/cost telemetry.
 *
 * Example:
 *   for await (const ev of runTaskStream({ task_type: "generate_text", user_prompt: "Hi" })) {
 *     if (ev.type === "delta") process.stdout.write(ev.content);
 *     else if (ev.type === "done") console.log("\n--- tokens:", ev.meta.tokens_out);
 *     else if (ev.type === "error") throw new EngineError(ev.code, ev.message);
 *   }
 */
export async function* runTaskStream(
  req: TaskRequest,
  opts?: ClientOptions,
): AsyncGenerator<StreamEvent, void, unknown> {
  const url = resolveBaseUrl(opts);
  const readTimeoutMs = opts?.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
  const { signal, cancel } = withTimeout(readTimeoutMs);

  try {
    const resp = await fetch(`${url}/task/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task_type: req.task_type,
        model_preference: req.model_preference ?? "fast",
        system_prompt: req.system_prompt ?? "",
        user_prompt: req.user_prompt ?? "",
        max_retries: req.max_retries ?? 1,
        ...(req.messages !== undefined && { messages: req.messages }),
        ...(req.model !== undefined && { model: req.model }),
        ...(req.context_budget !== undefined && { context_budget: req.context_budget }),
        ...(req.temperature !== undefined && { temperature: req.temperature }),
        ...(req.max_tokens !== undefined && { max_tokens: req.max_tokens }),
        ...(req.runtime !== undefined && { runtime: req.runtime }),
      }),
      signal,
    });
    if (!resp.ok || !resp.body) {
      throw new EngineError("HTTP_ERROR", `${resp.status} ${resp.statusText}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          yield JSON.parse(line) as StreamEvent;
        } catch {
          // eslint-disable-next-line no-console
          console.warn("sanctum-engine-client: unparseable stream line:", line.slice(0, 120));
        }
      }
    }

    // Flush any trailing line without newline (unlikely but safe)
    const tail = buffer.trim();
    if (tail) {
      try {
        yield JSON.parse(tail) as StreamEvent;
      } catch {
        /* ignore */
      }
    }
  } finally {
    cancel();
  }
}

/**
 * Run many tasks concurrently. Returns a list aligned with the input;
 * each slot is either `{ result, latencyMs }` on success or the thrown
 * error (so one model's failure doesn't sink the whole batch).
 */
export async function runTasksParallel(
  taskSpecs: Array<{ req: TaskRequest; onComplete?: OnCompleteCallback }>,
  opts?: ClientOptions,
): Promise<Array<{ result: unknown; latencyMs: number } | Error>> {
  return Promise.all(
    taskSpecs.map(async ({ req, onComplete }) => {
      try {
        return await runTask(req, { ...opts, onComplete });
      } catch (e) {
        return e instanceof Error ? e : new Error(String(e));
      }
    }),
  );
}

// Re-export types + error for consumers
export { EngineError };
export type {
  TaskType,
  ModelPreference,
  ChunkingConfig,
  ChatMessage,
  TaskRequest,
  TaskMeta,
  AttemptError,
  TaskError,
  TaskResponse,
  EmbedResponse,
  ClientOptions,
  OnCompleteCallback,
  StreamEvent,
} from "./types.js";
