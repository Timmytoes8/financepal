import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { waitForDiagnosticEventsDrained } from "../infra/diagnostic-events.js";
import { createDiagnosticTraceContext } from "../infra/diagnostic-trace-context.js";
import {
  getDevLlmTrace,
  listDevLlmTraces,
  recordDevLlmTraceCompleted,
  recordDevLlmTraceRequestPayload,
  recordDevLlmTraceStarted,
  resetDevLlmTracesForTest,
  resolveDevLlmTraceConfig,
} from "../infra/llm-dev-tracing.js";
import { wrapStreamFnWithDiagnosticModelCallEvents } from "./pi-embedded-runner/run/attempt.model-diagnostic-events.js";

const ENV_KEYS = ["OPENCLAW_DEV_EXTENDED_TRACING"] as const;

const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function enableRawTracing() {
  process.env.OPENCLAW_DEV_EXTENDED_TRACING = "1";
}

async function consume(value: unknown): Promise<void> {
  if (!value || typeof value !== "object") {
    return;
  }
  const iterator = (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator];
  if (typeof iterator !== "function") {
    return;
  }
  for await (const chunk of iterator.call(value) as AsyncIterable<unknown>) {
    void chunk;
    // Consume the observed stream so completion and response capture run.
  }
}

afterEach(async () => {
  for (const key of ENV_KEYS) {
    const saved = savedEnv[key];
    if (saved === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved;
    }
  }
  resetDevLlmTracesForTest();
  await waitForDiagnosticEventsDrained();
});

describe("dev LLM tracing", () => {
  it("requires source checkout and the explicit extended tracing flag", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-tracing-packaged-"));
    const env = {
      OPENCLAW_DEV_EXTENDED_TRACING: "1",
    } as NodeJS.ProcessEnv;

    expect(resolveDevLlmTraceConfig({ env, installRoot: tempDir })).toMatchObject({
      available: false,
      payloadCaptureEnabled: false,
      responseCaptureEnabled: false,
      sourceCheckout: false,
    });

    fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, "src", "entry.ts"), "export {};\n");
    expect(resolveDevLlmTraceConfig({ env, installRoot: tempDir })).toMatchObject({
      available: true,
      payloadCaptureEnabled: true,
      responseCaptureEnabled: true,
      sourceCheckout: true,
    });
  });

  it("stores full raw final request payloads and tool schemas when enabled", () => {
    enableRawTracing();
    const call = {
      callId: "run-1:model:1",
      model: "gpt-5.5",
      provider: "openai",
      runId: "run-1",
      trace: createDiagnosticTraceContext({
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        spanId: "00f067aa0ba902b7",
      }),
    };
    const payload = {
      input: [{ content: [{ text: "full prompt text", type: "input_text" }], role: "user" }],
      model: "gpt-5.5",
      tools: [
        {
          name: "shell_exec",
          parameters: { properties: { cmd: { type: "string" } }, type: "object" },
          type: "function",
        },
      ],
    };

    recordDevLlmTraceStarted(call);
    recordDevLlmTraceRequestPayload(call, payload);
    recordDevLlmTraceCompleted(call, { durationMs: 25, requestPayloadBytes: 1234 });

    expect(listDevLlmTraces()[0]).toMatchObject({
      id: "run-1:model:1",
      inputItemCount: 1,
      toolCount: 1,
      hasRequestPayload: true,
      status: "completed",
    });
    expect(getDevLlmTrace("run-1:model:1")?.requestPayload).toEqual(payload);
  });

  it("captures the final provider payload after caller onPayload mutations", async () => {
    enableRawTracing();
    const streamFn: StreamFn = (model, _context, options) => {
      const payload = {
        input: [{ content: [{ text: "original prompt", type: "input_text" }], role: "user" }],
        model: (model as { id?: string }).id,
        tools: [{ name: "original_tool", parameters: { type: "object" }, type: "function" }],
      };
      const stream = createAssistantMessageEventStream();
      const payloadReady = Promise.resolve(options?.onPayload?.(payload, model));
      void payloadReady.then(() => {
        stream.push({
          type: "done",
          reason: "stop",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "hello" }],
            api: "responses",
            provider: "openai",
            model: "gpt-5.5",
            stopReason: "stop",
            timestamp: Date.now(),
          },
        } as never);
        stream.end();
      });
      return stream;
    };
    const wrapped = wrapStreamFnWithDiagnosticModelCallEvents(streamFn, {
      model: "gpt-5.5",
      nextCallId: () => "run-2:model:1",
      provider: "openai",
      runId: "run-2",
      trace: createDiagnosticTraceContext({
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        spanId: "00f067aa0ba902b7",
      }),
    });
    const result = wrapped(
      { api: "responses", id: "gpt-5.5", provider: "openai" } as Parameters<StreamFn>[0],
      {} as Parameters<StreamFn>[1],
      {
        onPayload: (payload) => ({
          ...(payload as Record<string, unknown>),
          input: [{ content: [{ text: "final prompt", type: "input_text" }], role: "user" }],
          tools: [{ name: "final_tool", parameters: { type: "object" }, type: "function" }],
        }),
      } as Parameters<StreamFn>[2],
    );

    await consume(result);

    expect(getDevLlmTrace("run-2:model:1")).toMatchObject({
      requestPayload: {
        input: [{ content: [{ text: "final prompt", type: "input_text" }], role: "user" }],
        tools: [{ name: "final_tool", parameters: { type: "object" }, type: "function" }],
      },
      responseChunkCount: 1,
      status: "completed",
      toolCount: 1,
    });
  });
});
