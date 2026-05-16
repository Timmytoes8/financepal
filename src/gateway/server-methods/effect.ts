import { runOpenClawEffect, type OpenClawEffect } from "../../effect-runtime/index.js";
import { ErrorCodes, errorShape, type ErrorShape } from "../protocol/index.js";
import type { RespondFn } from "./types.js";

type GatewayEffectErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class GatewayMethodEffectError extends Error {
  constructor(
    readonly code: GatewayEffectErrorCode,
    message: string,
    readonly opts?: { details?: unknown; retryable?: boolean; retryAfterMs?: number },
  ) {
    super(message);
    this.name = "GatewayMethodEffectError";
  }
}

export function invalidGatewayMethodRequest(message: string): GatewayMethodEffectError {
  return new GatewayMethodEffectError(ErrorCodes.INVALID_REQUEST, message);
}

function shapeGatewayMethodError(error: unknown): ErrorShape {
  if (error instanceof GatewayMethodEffectError) {
    return errorShape(error.code, error.message, error.opts);
  }
  return errorShape(
    ErrorCodes.UNAVAILABLE,
    error instanceof Error ? error.message : "gateway method failed",
  );
}

export async function respondWithGatewayEffect<T>(params: {
  respond: RespondFn;
  effect: OpenClawEffect<T, unknown>;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    const payload = await runOpenClawEffect(params.effect);
    if (params.meta) {
      params.respond(true, payload, undefined, params.meta);
      return;
    }
    params.respond(true, payload, undefined);
  } catch (error) {
    params.respond(false, undefined, shapeGatewayMethodError(error));
  }
}
