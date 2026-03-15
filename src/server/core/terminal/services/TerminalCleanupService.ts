import { Context, Effect, Layer } from "effect";
import type { InferEffect } from "../../../lib/effect/types";

// With tmux as the source of truth, idle PTY cleanup is no longer needed.
// tmux sessions persist intentionally and PTY attachments are cleaned up
// via the grace period on WS disconnect. This service is kept as a no-op
// to avoid breaking the dependency chain.
const LayerImpl = Effect.gen(function* () {
  const startCleanup = () => Effect.void;

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
