import { Context, Effect, Either, Layer } from "effect";
import type { ControllerResponse } from "../../../lib/effect/toEffectResponse";
import type { InferEffect } from "../../../lib/effect/types";
import { TskService } from "../../tsk/services/TskService";
import { TerminalSessionService } from "../services/TerminalSessionService";

const LayerImpl = Effect.gen(function* () {
  const terminalSessionService = yield* TerminalSessionService;
  const tskService = yield* TskService;

  const createTerminal = (options: { taskId: string }) =>
    Effect.gen(function* () {
      const { taskId } = options;

      // Look up the task to get its container_id
      const tasks = yield* tskService.listTasks();
      const task = tasks.find((t) => t.id === taskId);

      if (!task) {
        return {
          status: 404,
          response: { error: "Task not found" },
        } as const satisfies ControllerResponse;
      }

      if (!task.container_id) {
        return {
          status: 400,
          response: { error: "Task has no running container" },
        } as const satisfies ControllerResponse;
      }

      const result = yield* Effect.either(
        terminalSessionService.createSession(taskId, task.container_id),
      );

      if (Either.isLeft(result)) {
        const errorMsg =
          result.left instanceof Error
            ? result.left.message
            : String(result.left);
        return {
          status: 500,
          response: {
            error: `Failed to create terminal session: ${errorMsg}`,
          },
        } as const satisfies ControllerResponse;
      }

      return {
        status: 200,
        response: {
          id: result.right.sessionId,
          taskId,
          containerId: task.container_id,
          createdAt: new Date().toISOString(),
        },
      } as const satisfies ControllerResponse;
    });

  const destroyTerminal = (options: { sessionId: string }) =>
    Effect.gen(function* () {
      yield* terminalSessionService.destroySession(options.sessionId);
      return {
        status: 200,
        response: { success: true },
      } as const satisfies ControllerResponse;
    });

  const listTerminals = () =>
    Effect.gen(function* () {
      const sessions = yield* terminalSessionService.listSessions();
      return {
        status: 200,
        response: sessions,
      } as const satisfies ControllerResponse;
    });

  return {
    createTerminal,
    destroyTerminal,
    listTerminals,
  };
});

export type ITerminalController = InferEffect<typeof LayerImpl>;
export class TerminalController extends Context.Tag("TerminalController")<
  TerminalController,
  ITerminalController
>() {
  static Live = Layer.effect(this, LayerImpl);
}
