import { Context, Duration, Effect, Layer, Schedule } from "effect";
import type { InferEffect } from "../../../lib/effect/types";
import { TerminalSessionService } from "./TerminalSessionService";

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const CLEANUP_INTERVAL = Duration.seconds(30);

const LayerImpl = Effect.gen(function* () {
  const terminalSessionService = yield* TerminalSessionService;

  const startCleanup = () =>
    Effect.gen(function* () {
      yield* terminalSessionService.cleanupIdleSessions(IDLE_TIMEOUT_MS);
    }).pipe(
      Effect.repeat(Schedule.spaced(CLEANUP_INTERVAL)),
      Effect.catchAll(() => Effect.void),
      Effect.fork,
    );

  return {
    startCleanup,
  };
});

export type ITerminalCleanupService = InferEffect<typeof LayerImpl>;
export class TerminalCleanupService extends Context.Tag(
  "TerminalCleanupService",
)<TerminalCleanupService, ITerminalCleanupService>() {
  static Live = Layer.effect(this, LayerImpl);
}
