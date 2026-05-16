import { runRetryingPromise } from "../effect-runtime/retry.js";
import { sleepWithAbort } from "../infra/backoff.js";
import { formatErrorMessage } from "../infra/errors.js";
import {
  resolveTransientProviderAttempts,
  resolveTransientProviderDelayMs,
  resolveTransientProviderRetryOptions,
  shouldRetrySameKeyProviderOperation,
  type TransientProviderRetryConfig,
} from "../provider-runtime/operation-retry.js";
import { collectProviderApiKeys, isApiKeyRateLimitError } from "./live-auth-keys.js";

class RotateApiKeyError extends Error {
  constructor(
    readonly error: unknown,
    readonly messageForRetry: string,
  ) {
    super(messageForRetry);
    this.name = "RotateApiKeyError";
  }
}

type ApiKeyRetryParams = {
  apiKey: string;
  error: unknown;
  attempt: number;
};

type ExecuteWithApiKeyRotationOptions<T> = {
  provider: string;
  apiKeys: string[];
  execute: (apiKey: string) => Promise<T>;
  shouldRetry?: (params: ApiKeyRetryParams & { message: string }) => boolean;
  onRetry?: (params: ApiKeyRetryParams & { message: string }) => void;
  transientRetry?: TransientProviderRetryConfig;
};

function dedupeApiKeys(raw: string[]): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const value of raw) {
    const apiKey = value.trim();
    if (!apiKey || seen.has(apiKey)) {
      continue;
    }
    seen.add(apiKey);
    keys.push(apiKey);
  }
  return keys;
}

export function collectProviderApiKeysForExecution(params: {
  provider: string;
  primaryApiKey?: string;
}): string[] {
  const { primaryApiKey, provider } = params;
  return dedupeApiKeys([primaryApiKey?.trim() ?? "", ...collectProviderApiKeys(provider)]);
}

export async function executeWithApiKeyRotation<T>(
  params: ExecuteWithApiKeyRotationOptions<T>,
): Promise<T> {
  const keys = dedupeApiKeys(params.apiKeys);
  if (keys.length === 0) {
    throw new Error(`No API keys configured for provider "${params.provider}".`);
  }

  let lastError: unknown;
  const transientRetry = resolveTransientProviderRetryOptions(params.transientRetry);
  for (let apiKeyIndex = 0; apiKeyIndex < keys.length; apiKeyIndex += 1) {
    const apiKey = keys[apiKeyIndex];
    const maxOperationAttempts = resolveTransientProviderAttempts(transientRetry);
    try {
      return await runRetryingPromise({
        operation: async () => {
          try {
            return await params.execute(apiKey);
          } catch (error) {
            lastError = error;
            const message = formatErrorMessage(error);
            const rotateKey = params.shouldRetry
              ? params.shouldRetry({ apiKey, error, attempt: apiKeyIndex, message })
              : isApiKeyRateLimitError(message);

            if (rotateKey) {
              throw new RotateApiKeyError(error, message);
            }

            throw error;
          }
        },
        maxAttempts: maxOperationAttempts,
        shouldRetry: (error, attemptNumber) => {
          if (!transientRetry || error instanceof RotateApiKeyError) {
            return false;
          }
          return shouldRetrySameKeyProviderOperation({
            options: transientRetry,
            error,
            message: formatErrorMessage(error),
            provider: params.provider,
            apiKeyIndex,
            attemptNumber,
            maxAttempts: maxOperationAttempts,
          });
        },
        resolveDelayMs: (attemptNumber) =>
          transientRetry ? resolveTransientProviderDelayMs(transientRetry, attemptNumber) : 0,
        sleep: async (delayMs) => {
          const sleep = transientRetry?.sleep ?? sleepWithAbort;
          await sleep(delayMs, transientRetry?.signal);
        },
      });
    } catch (error) {
      if (error instanceof RotateApiKeyError) {
        lastError = error.error;
        if (apiKeyIndex + 1 >= keys.length) {
          break;
        }
        params.onRetry?.({
          apiKey,
          error: error.error,
          attempt: apiKeyIndex,
          message: error.messageForRetry,
        });
        continue;
      }
      lastError = error;
      break;
    }
  }

  if (lastError === undefined) {
    throw new Error(`Failed to run API request for ${params.provider}.`);
  }
  throw lastError;
}
