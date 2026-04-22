/**
 * Shared types for the Sanctum Engine TS client.
 *
 * Mirrors the server's Pydantic schemas in
 * https://github.com/SanctumSuite/sanctum-engine/blob/main/app/models/schemas.py
 * — keep these in sync when Engine's API surface grows.
 */

export type TaskType =
  | "generate_text"
  | "extract_json"
  | "embed"
  | "vision"
  | "translate"
  | "rerank";

export type ModelPreference =
  | "reasoning"
  | "fast"
  | "vision"
  | "embedding"
  | "translation"
  | "ocr"
  | (string & {}); // allow arbitrary model name strings too

export interface ChunkingConfig {
  enabled?: boolean;
  chunk_tokens?: number;
  overlap_tokens?: number;
  merge_strategy?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface TaskRequest {
  task_type: TaskType;
  model_preference?: ModelPreference;
  /** Prompt-pair mode. Ignored when `messages` is set. */
  system_prompt?: string;
  /** Prompt-pair mode. Ignored when `messages` is set. */
  user_prompt?: string;
  /** Multi-turn mode. When set, overrides system_prompt + user_prompt. */
  messages?: ChatMessage[];
  model?: string;
  output_schema?: Record<string, unknown>;
  max_retries?: number;
  context_budget?: number;
  temperature?: number;
  max_tokens?: number;
  chunking?: ChunkingConfig;
  runtime?: "ollama" | "openrouter";
  /** Per-request API key for cloud runtimes (OpenRouter). Overrides the
   *  Engine's server-side key — used by bring-your-own-key apps. */
  runtime_api_key?: string;
}

export interface TaskMeta {
  task_id: string;
  model_used: string;
  runtime: string;
  tokens_in: number;
  tokens_out: number;
  context_window: number;
  context_utilization: number;
  latency_ms: number;
  attempts: number;
  temperature: number;
  cost_usd?: number;
}

export interface AttemptError {
  attempt: number;
  error: string;
  raw_length: number;
}

export interface TaskError {
  code: string;
  message: string;
  attempts?: AttemptError[];
}

export interface TaskResponse<T = unknown> {
  status: "success" | "error";
  result?: T;
  error?: TaskError;
  meta: TaskMeta;
}

export interface EmbedResponse {
  embeddings: number[][];
  model: string;
  dimensions: number;
}

export interface ClientOptions {
  /** Engine base URL. Defaults to `process.env.ENGINE_URL` or `http://localhost:8100`. */
  baseUrl?: string;
  /** Per-request read timeout in ms. Defaults to 120000. */
  readTimeoutMs?: number;
  /** Per-request connect timeout in ms. Defaults to 10000. */
  connectTimeoutMs?: number;
}

export type OnCompleteCallback = (meta: TaskMeta) => void | Promise<void>;

/** NDJSON stream events from POST /task/stream. */
export type StreamEvent =
  | { type: "delta"; content: string }
  | { type: "done"; meta: TaskMeta }
  | { type: "error"; code: string; message: string };

export class EngineError extends Error {
  code: string;
  attempts: AttemptError[];

  constructor(code: string, message: string, attempts: AttemptError[] = []) {
    super(`${code}: ${message}`);
    this.name = "EngineError";
    this.code = code;
    this.attempts = attempts;
  }
}
