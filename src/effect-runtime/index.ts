import { Effect, Either } from "effect";

export type OpenClawEffect<A, E = never, R = never> = Effect.Effect<A, E, R>;

export function promiseEffect<A, E = unknown>(params: {
  try: (signal: AbortSignal) => PromiseLike<A>;
  catch?: (error: unknown) => E;
}): OpenClawEffect<A, E> {
  return Effect.tryPromise({
    try: params.try,
    catch: params.catch ?? ((error) => error as E),
  });
}

export function syncEffect<A, E = unknown>(params: {
  try: () => A;
  catch?: (error: unknown) => E;
}): OpenClawEffect<A, E> {
  return Effect.try({
    try: params.try,
    catch: params.catch ?? ((error) => error as E),
  });
}

export async function runOpenClawEffect<A, E>(
  effect: OpenClawEffect<A, E>,
): Promise<A> {
  const result = await Effect.runPromise(Effect.either(effect));
  if (Either.isLeft(result)) {
    throw result.left;
  }
  return result.right;
}

export function runOpenClawEffectSync<A, E>(effect: OpenClawEffect<A, E>): A {
  const result = Effect.runSync(Effect.either(effect));
  if (Either.isLeft(result)) {
    throw result.left;
  }
  return result.right;
}
