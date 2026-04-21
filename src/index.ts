/**
 * sanctum-engine-client — TypeScript/JavaScript client for Sanctum Engine.
 *
 * Usage:
 *   import * as engineClient from "sanctum-engine-client";
 *   const { result } = await engineClient.runTask({
 *     task_type: "generate_text",
 *     model_preference: "fast",
 *     user_prompt: "Hello",
 *   });
 *
 * Or import individual functions:
 *   import { runTask, translate, embedTexts } from "sanctum-engine-client";
 */
export * from "./engineClient.js";
