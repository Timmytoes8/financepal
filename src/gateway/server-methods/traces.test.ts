import { afterEach, describe, expect, it } from "vitest";
import {
  recordDevLlmTraceCompleted,
  recordDevLlmTraceRequestPayload,
  recordDevLlmTraceStarted,
  resetDevLlmTracesForTest,
} from "../../infra/llm-dev-tracing.js";
import { GATEWAY_CLIENT_IDS, GATEWAY_CLIENT_MODES } from "../protocol/client-info.js";
import { PROTOCOL_VERSION } from "../protocol/version.js";
import { tracesHandlers } from "./traces.js";
import type { GatewayClient, GatewayRequestHandlerOptions } from "./types.js";

const ENV_KEYS = ["OPENCLAW_DEV_EXTENDED_TRACING"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function enableRawTracing() {
  process.env.OPENCLAW_DEV_EXTENDED_TRACING = "1";
}

function createClient(
  opts: { clientIp?: string; isLocalClient?: boolean; allowsDevLlmTracing?: boolean } = {},
): GatewayClient {
  const isLocalClient = opts.isLocalClient ?? true;
  return {
    isLocalClient,
    allowsDevLlmTracing: opts.allowsDevLlmTracing ?? isLocalClient,
    ...(opts.clientIp ? { clientIp: opts.clientIp } : {}),
    connect: {
      client: {
        id: GATEWAY_CLIENT_IDS.CONTROL_UI,
        mode: GATEWAY_CLIENT_MODES.UI,
        platform: "test",
        version: "test",
      },
      maxProtocol: PROTOCOL_VERSION,
      minProtocol: PROTOCOL_VERSION,
      role: "operator",
      scopes: ["operator.admin"],
    },
  };
}

type HandlerResponse = {
  ok: boolean;
  payload?: unknown;
  error?: unknown;
  meta?: Record<string, unknown>;
};

async function callHandler(
  method: keyof typeof tracesHandlers,
  params: Record<string, unknown>,
  client: GatewayClient | null,
) {
  const responses: HandlerResponse[] = [];
  await tracesHandlers[method]({
    client,
    context: {} as GatewayRequestHandlerOptions["context"],
    isWebchatConnect: () => false,
    params,
    req: { id: "req-1", method, params, type: "req" },
    respond: (ok, payload, error, meta) => {
      responses.push({ ok, payload, error, meta });
    },
  });
  const response = responses.at(-1);
  if (!response) {
    throw new Error("handler did not respond");
  }
  return response;
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    const saved = savedEnv[key];
    if (saved === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved;
    }
  }
  resetDevLlmTracesForTest();
});

describe("traces gateway methods", () => {
  it("returns unavailable until explicit extended tracing is enabled", async () => {
    const res = await callHandler("traces.capabilities", {}, createClient());
    expect(res.ok).toBe(true);
    expect(res.payload).toMatchObject({
      available: false,
      reasons: expect.arrayContaining(["env_flag_missing"]),
    });
  });

  it("lists and returns captured raw prompt and tool payloads for local admin clients", async () => {
    enableRawTracing();
    const call = {
      callId: "run-1:model:1",
      model: "gpt-5.5",
      provider: "openai",
      runId: "run-1",
    };
    const payload = {
      input: [{ content: [{ text: "show me the full prompt", type: "input_text" }], role: "user" }],
      tools: [{ name: "read_file", parameters: { type: "object" }, type: "function" }],
    };
    recordDevLlmTraceStarted(call);
    recordDevLlmTraceRequestPayload(call, payload);
    recordDevLlmTraceCompleted(call, { durationMs: 50, requestPayloadBytes: 777 });

    const list = await callHandler("traces.list", {}, createClient());
    expect(list.ok).toBe(true);
    expect(list.payload).toMatchObject({
      traces: [expect.objectContaining({ id: "run-1:model:1", toolCount: 1 })],
    });

    const detail = await callHandler("traces.get", { id: "run-1:model:1" }, createClient());
    expect(detail.ok).toBe(true);
    expect(detail.payload).toMatchObject({ trace: { requestPayload: payload } });
  });

  it("rejects trace reads for non-local clients", async () => {
    enableRawTracing();
    const res = await callHandler(
      "traces.list",
      {},
      createClient({ clientIp: "203.0.113.10", isLocalClient: false }),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatchObject({ code: "UNAVAILABLE" });
  });

  it("does not treat missing reported client IP as local", async () => {
    enableRawTracing();
    const res = await callHandler("traces.list", {}, createClient({ isLocalClient: false }));
    expect(res.ok).toBe(false);
    expect(res.error).toMatchObject({ code: "UNAVAILABLE" });
  });

  it("requires the stricter development trace UI locality grant", async () => {
    enableRawTracing();
    const res = await callHandler(
      "traces.list",
      {},
      createClient({ isLocalClient: true, allowsDevLlmTracing: false }),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatchObject({ code: "UNAVAILABLE" });
  });
});
