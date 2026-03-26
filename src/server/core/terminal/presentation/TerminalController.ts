import { Context, Effect, Either, Layer } from "effect";
import type { ControllerResponse } from "../../../lib/effect/toEffectResponse";
import type { InferEffect } from "../../../lib/effect/types";
import { TskService } from "../../tsk/services/TskService";
import { TerminalSessionService } from "../services/TerminalSessionService";

const LayerImpl = Effect.gen(function* () {
  const terminalSessionService = yield* TerminalSessionService;
  const tskService = yield* TskService;

  const resolveContainerId = (taskId: string) =>
    Effect.gen(function* () {
      const tasks = yield* tskService.listTasks();
      const task = tasks.find((t) => t.id === taskId);
      if (!task)
        return {
          ok: false,
          status: 404,
          error: "Task not found",
        } as const;
      if (!task.container_id)
        return {
          ok: false,
          status: 400,
          error: "Task has no running container",
        } as const;
      return { ok: true, containerId: task.container_id } as const;
    });

  const ensureTerminal = (options: {
    taskId: string;
    name: string;
    cols?: number;
    rows?: number;
  }) =>
    Effect.gen(function* () {
      const { taskId, name, cols, rows } = options;
      const resolved = yield* resolveContainerId(taskId);
      if (!resolved.ok) {
        return {
          status: resolved.status,
          response: { error: resolved.error },
        } as const satisfies ControllerResponse;
      }

      const result = yield* Effect.either(
        terminalSessionService.ensureTmuxSession(
          resolved.containerId,
          name,
          cols,
          rows,
        ),
      );

      if (Either.isLeft(result)) {
        const errorMsg =
          result.left instanceof Error
            ? result.left.message
            : String(result.left);
        return {
          status: 500,
          response: {
            error: `Failed to ensure terminal session: ${errorMsg}`,
          },
        } as const satisfies ControllerResponse;
      }

      return {
        status: 200,
        response: result.right,
      } as const satisfies ControllerResponse;
    });

  const listTerminals = (options: { taskId: string }) =>
    Effect.gen(function* () {
      const resolved = yield* resolveContainerId(options.taskId);
      if (!resolved.ok) {
        return {
          status: resolved.status,
          response: { error: resolved.error },
        } as const satisfies ControllerResponse;
      }

      const tmuxSessions = yield* terminalSessionService.listTmuxSessions(
        resolved.containerId,
      );

      const sessions = tmuxSessions.map((name) => {
        const attachment = Effect.runSync(
          terminalSessionService.getPtyAttachment(resolved.containerId, name),
        );
        return { name, attached: attachment !== null };
      });

      return {
        status: 200,
        response: sessions,
      } as const satisfies ControllerResponse;
    });

  const destroyTerminal = (options: { taskId: string; name: string }) =>
    Effect.gen(function* () {
      const resolved = yield* resolveContainerId(options.taskId);
      if (!resolved.ok) {
        return {
          status: resolved.status,
          response: { error: resolved.error },
        } as const satisfies ControllerResponse;
      }

      yield* Effect.either(
        terminalSessionService.destroyTmuxSession(
          resolved.containerId,
          options.name,
        ),
      );

      return {
        status: 200,
        response: { success: true },
      } as const satisfies ControllerResponse;
    });

  const reconfigureTmux = (options: { taskId: string }) =>
    Effect.gen(function* () {
      const resolved = yield* resolveContainerId(options.taskId);
      if (!resolved.ok) {
        return {
          status: resolved.status,
          response: { error: resolved.error },
        } as const satisfies ControllerResponse;
      }

      const result = yield* Effect.either(
        terminalSessionService.reconfigureTmux(resolved.containerId),
      );

      if (Either.isLeft(result)) {
        const errorMsg =
          result.left instanceof Error
            ? result.left.message
            : String(result.left);
        return {
          status: 500,
          response: { error: `Failed to reconfigure tmux: ${errorMsg}` },
        } as const satisfies ControllerResponse;
      }

      return {
        status: 200,
        response: result.right,
      } as const satisfies ControllerResponse;
    });

  return {
    ensureTerminal,
    listTerminals,
    destroyTerminal,
    reconfigureTmux,
  };
});

export type ITerminalController = InferEffect<typeof LayerImpl>;
export class TerminalController extends Context.Tag("TerminalController")<
  TerminalController,
  ITerminalController
>() {
  static Live = Layer.effect(this, LayerImpl);
}
