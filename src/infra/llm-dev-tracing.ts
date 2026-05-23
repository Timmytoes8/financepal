import { isSourceCheckoutInstallRoot } from "../entry.compile-cache.js";
import type { DiagnosticTraceContext } from "./diagnostic-trace-context.js";
import { resolveOpenClawPackageRootSync } from "./openclaw-root.js";

export type DevLlmTraceStatus = "running" | "completed" | "error";

export type DevLlmTraceConfig = {
  available: boolean;
  sourceCheckout: boolean;
  uiEnabled: boolean;
  payloadCaptureEnabled: boolean;
  responseCaptureEnabled: boolean;
  store: "memory";
  reasons: string[];
};

export type DevLlmTraceModelCall = {
  runId: string;
  callId: string;
  sessionKey?: string;
  sessionId?: string;
  provider: string;
  model: string;
  api?: string;
  transport?: string;
  trace?: DiagnosticTraceContext;
};

export type DevLlmTraceCompletion = {
  durationMs?: number;
  requestPayloadBytes?: number;
  responseStreamBytes?: number;
  timeToFirstByteMs?: number;
};

export type DevLlmTraceError = DevLlmTraceCompletion & {
  errorCategory?: string;
  failureKind?: string;
};

export type DevLlmTraceSummary = DevLlmTraceModelCall & {
  id: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  status: DevLlmTraceStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  requestPayloadBytes?: number;
  responseStreamBytes?: number;
  timeToFirstByteMs?: number;
  inputItemCount?: number;
  toolCount?: number;
  responseChunkCount: number;
  hasRequestPayload: boolean;
  hasResponseChunks: boolean;
  errorCategory?: string;
  failureKind?: string;
};

export type DevLlmTraceDetail = DevLlmTraceSummary & {
  requestPayload?: unknown;
  responseChunks?: unknown[];
};

type DevLlmTraceRecord = DevLlmTraceSummary & {
  requestPayload?: unknown;
  responseChunks: unknown[];
};

const TRACE_LIMIT = 200;
const RESPONSE_CHUNK_LIMIT = 100;

const traces = new Map<string, DevLlmTraceRecord>();
const traceOrder: string[] = [];
let cachedDefaultSourceCheckout: boolean | null = null;

function normalizeEnv(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isTruthyEnv(value: unknown): boolean {
  const normalized = normalizeEnv(value);
  return (
    normalized.length > 0 &&
    normalized !== "0" &&
    normalized !== "false" &&
    normalized !== "off" &&
    normalized !== "no"
  );
}

function resolveSourceCheckout(params?: { installRoot?: string | null }): boolean {
  if (params && Object.hasOwn(params, "installRoot")) {
    return params.installRoot ? isSourceCheckoutInstallRoot(params.installRoot) : false;
  }
  if (cachedDefaultSourceCheckout !== null) {
    return cachedDefaultSourceCheckout;
  }
  const installRoot = resolveOpenClawPackageRootSync({
    argv1: process.argv[1],
    cwd: process.cwd(),
    moduleUrl: import.meta.url,
  });
  cachedDefaultSourceCheckout = installRoot ? isSourceCheckoutInstallRoot(installRoot) : false;
  return cachedDefaultSourceCheckout;
}

export function resolveDevLlmTraceConfig(params?: {
  env?: NodeJS.ProcessEnv;
  installRoot?: string | null;
}): DevLlmTraceConfig {
  const env = params?.env ?? process.env;
  const extendedTracingEnabled = isTruthyEnv(env.OPENCLAW_DEV_EXTENDED_TRACING);
  const shouldProbeSourceCheckout =
    extendedTracingEnabled || Boolean(params && Object.hasOwn(params, "installRoot"));
  const sourceCheckout = shouldProbeSourceCheckout ? resolveSourceCheckout(params) : false;
  const available = sourceCheckout && extendedTracingEnabled;
  const reasons: string[] = [];
  if (shouldProbeSourceCheckout && !sourceCheckout) {
    reasons.push("not_source_checkout");
  }
  if (!extendedTracingEnabled) {
    reasons.push("env_flag_missing");
  }
  return {
    available,
    sourceCheckout,
    uiEnabled: available,
    payloadCaptureEnabled: available,
    responseCaptureEnabled: available,
    store: "memory",
    reasons,
  };
}

function cloneTraceValue(value: unknown): unknown {
  try {
    return structuredClone(value);
  } catch {
    try {
      return JSON.parse(JSON.stringify(value)) as unknown;
    } catch {
      return String(value);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function arrayLength(value: unknown): number | undefined {
  return Array.isArray(value) ? value.length : undefined;
}

function countPayloadInputs(payload: unknown): number | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  return arrayLength(payload.input) ?? arrayLength(payload.messages);
}

function countPayloadTools(payload: unknown): number | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  return arrayLength(payload.tools) ?? arrayLength(payload.functions);
}

function toSummary(record: DevLlmTraceRecord): DevLlmTraceSummary {
  const { requestPayload: _requestPayload, responseChunks: _responseChunks, ...summary } = record;
  return {
    ...summary,
    responseChunkCount: record.responseChunks.length,
    hasRequestPayload: record.requestPayload !== undefined,
    hasResponseChunks: record.responseChunks.length > 0,
  };
}

function ensureRecord(call: DevLlmTraceModelCall): DevLlmTraceRecord | null {
  if (!resolveDevLlmTraceConfig().available) {
    return null;
  }
  const existing = traces.get(call.callId);
  if (existing) {
    return existing;
  }
  const record: DevLlmTraceRecord = {
    ...call,
    id: call.callId,
    traceId: call.trace?.traceId,
    spanId: call.trace?.spanId,
    parentSpanId: call.trace?.parentSpanId,
    status: "running",
    startedAt: new Date().toISOString(),
    responseChunkCount: 0,
    responseChunks: [],
    hasRequestPayload: false,
    hasResponseChunks: false,
  };
  traces.set(record.id, record);
  traceOrder.unshift(record.id);
  while (traceOrder.length > TRACE_LIMIT) {
    const evicted = traceOrder.pop();
    if (evicted) {
      traces.delete(evicted);
    }
  }
  return record;
}

export function recordDevLlmTraceStarted(call: DevLlmTraceModelCall): void {
  ensureRecord(call);
}

export function recordDevLlmTraceRequestPayload(
  call: DevLlmTraceModelCall,
  payload: unknown,
): void {
  if (!resolveDevLlmTraceConfig().payloadCaptureEnabled) {
    return;
  }
  const record = ensureRecord(call);
  if (!record) {
    return;
  }
  const snapshot = cloneTraceValue(payload);
  record.requestPayload = snapshot;
  record.inputItemCount = countPayloadInputs(snapshot);
  record.toolCount = countPayloadTools(snapshot);
  record.hasRequestPayload = true;
}

export function recordDevLlmTraceResponseChunk(call: DevLlmTraceModelCall, chunk: unknown): void {
  if (!resolveDevLlmTraceConfig().responseCaptureEnabled) {
    return;
  }
  const record = ensureRecord(call);
  if (!record) {
    return;
  }
  if (record.responseChunks.length >= RESPONSE_CHUNK_LIMIT) {
    return;
  }
  record.responseChunks.push(cloneTraceValue(chunk));
  record.responseChunkCount = record.responseChunks.length;
  record.hasResponseChunks = true;
}

export function recordDevLlmTraceCompleted(
  call: DevLlmTraceModelCall,
  completion: DevLlmTraceCompletion,
): void {
  const record = ensureRecord(call);
  if (!record) {
    return;
  }
  record.status = "completed";
  record.completedAt = new Date().toISOString();
  record.durationMs = completion.durationMs;
  record.requestPayloadBytes = completion.requestPayloadBytes;
  record.responseStreamBytes = completion.responseStreamBytes;
  record.timeToFirstByteMs = completion.timeToFirstByteMs;
}

export function recordDevLlmTraceError(call: DevLlmTraceModelCall, error: DevLlmTraceError): void {
  const record = ensureRecord(call);
  if (!record) {
    return;
  }
  record.status = "error";
  record.completedAt = new Date().toISOString();
  record.durationMs = error.durationMs;
  record.requestPayloadBytes = error.requestPayloadBytes;
  record.responseStreamBytes = error.responseStreamBytes;
  record.timeToFirstByteMs = error.timeToFirstByteMs;
  record.errorCategory = error.errorCategory;
  record.failureKind = error.failureKind;
}

export function listDevLlmTraces(): DevLlmTraceSummary[] {
  return traceOrder.flatMap((id) => {
    const record = traces.get(id);
    return record ? [toSummary(record)] : [];
  });
}

export function getDevLlmTrace(id: string): DevLlmTraceDetail | null {
  const record = traces.get(id);
  if (!record) {
    return null;
  }
  return {
    ...toSummary(record),
    ...(record.requestPayload !== undefined
      ? { requestPayload: cloneTraceValue(record.requestPayload) }
      : {}),
    ...(record.responseChunks.length > 0
      ? { responseChunks: cloneTraceValue(record.responseChunks) as unknown[] }
      : {}),
  };
}

export function resetDevLlmTracesForTest(): void {
  traces.clear();
  traceOrder.length = 0;
  cachedDefaultSourceCheckout = null;
}
