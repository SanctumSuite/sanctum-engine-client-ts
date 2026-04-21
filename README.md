# sanctum-engine-client (TypeScript)

TypeScript/JavaScript client for [Sanctum Engine](https://github.com/SanctumSuite/sanctum-engine). Companion to the Python client that ships inside the Engine repo — same API shape, same semantics, for Node.js and browser apps in the [Sanctum Suite](https://github.com/SanctumSuite/sanctum-suite) (Consilium, SanctumKanban, SanctumWriter/Pro).

## Install

```bash
npm install "github:SanctumSuite/sanctum-engine-client-ts"
```

`npm` will clone the repo, install its dev deps, and run `tsc` via the `prepare` script to produce `dist/`. You'll import from the package as normal afterward.

Requires Node ≥ 18 (for global `fetch`). Works in the browser too.

## Use

```ts
import {
  runTask,
  translate,
  embedTexts,
  embedQuery,
  runTasksParallel,
  engineHealth,
  EngineError,
} from "sanctum-engine-client";

// Generic task call
const { result, latencyMs } = await runTask({
  task_type: "generate_text",
  model_preference: "reasoning",
  system_prompt: "You are a helpful assistant.",
  user_prompt: "Explain retries.",
  max_retries: 2,
});

// Translate (same signature as the Python client's translate())
const { result: translated } = await translate("Hello.", "English", "French");

// Embeddings
const vectors = await embedTexts(["hello world", "goodnight moon"]);
const vec = await embedQuery("what does foo mean?");

// Parallel multi-model compare
const results = await runTasksParallel([
  { req: { task_type: "generate_text", model: "qwen3:32b", user_prompt: "Summarize X" } },
  { req: { task_type: "generate_text", model: "gemma4:31b", user_prompt: "Summarize X" } },
]);
// results[i] is { result, latencyMs } or Error

// Health
const ok = await engineHealth();
```

## Config

Defaults read from env vars in Node; in the browser you pass `{ baseUrl }` per call.

| Env var | Default | Purpose |
|---|---|---|
| `ENGINE_URL` | `http://localhost:8100` | Engine base URL |
| `ENGINE_TIMEOUT_READ_MS` | `120000` | Per-request read timeout (ms) |
| `ENGINE_TIMEOUT_CONNECT_MS` | `10000` | Per-request connect timeout (ms) |

Or pass per-call:

```ts
await runTask(req, {
  baseUrl: "http://engine.prod.lan:8100",
  readTimeoutMs: 60000,
});
```

## Telemetry / cost tracking

Pass `onComplete` to receive Engine's full `meta` dict on success:

```ts
const costLog: Array<{ model: string; cost: number }> = [];

await runTask(req, {
  onComplete: (meta) => {
    costLog.push({
      model: meta.model_used,
      cost: meta.cost_usd ?? 0,
    });
  },
});
```

## Streaming

Not yet implemented. Engine's `/task` is single-shot today; streaming (`/task/stream`) is planned for a future version. Apps that need streaming (Consilium's multi-round council, Galatea's voice, SanctumWriter's AI writing) should continue to call Ollama / OpenRouter directly until the streaming endpoint ships.

## Versioning

Follows the Python client's version number (currently 0.1.0 / 0.1.2 on the Python side). Any breaking change on the Engine API bumps both clients in lockstep.

## License

Apache 2.0.
