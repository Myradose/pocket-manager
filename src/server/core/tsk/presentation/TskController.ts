import { Context, Effect, Either, Layer } from "effect";
import type { ControllerResponse } from "../../../lib/effect/toEffectResponse";
import type { InferEffect } from "../../../lib/effect/types";
import type { CreateTaskRequest, ServiceDisplayConfig } from "../schema";
import { ServiceDisplayConfigService } from "../services/ServiceDisplayConfigService";
import { TskService } from "../services/TskService";

const LayerImpl = Effect.gen(function* () {
  const tskService = yield* TskService;
  const serviceDisplayConfigService = yield* ServiceDisplayConfigService;

  const listTasks = (options?: { repo?: string }) =>
    Effect.gen(function* () {
      const tasks = yield* tskService.listTasks(options);
      return {
        status: 200,
        response: tasks,
      } as const satisfies ControllerResponse;
    });

  const getTaskTranscript = (options: { taskId: string }) =>
    Effect.gen(function* () {
      const result = yield* tskService.getTaskTranscript(options.taskId);
      return {
        status: 200,
        response: result,
      } as const satisfies ControllerResponse;
    });

  const createTask = (request: CreateTaskRequest) =>
    Effect.gen(function* () {
      const result = yield* Effect.either(tskService.createTask(request));
      if (Either.isLeft(result)) {
        return {
          status: 500,
          response: { error: result.left.message },
        } as const satisfies ControllerResponse;
      }
      const taskData = result.right as { id?: string };
      if (taskData.id) {
        tskService.launchClaudeWhenReady(taskData.id, request.description);
      }
      return {
        status: 200,
        response: { data: result.right },
      } as const satisfies ControllerResponse;
    });

  const deleteTask = (options: { taskId: string }) =>
    Effect.gen(function* () {
      const result = yield* Effect.either(
        tskService.deleteTask(options.taskId),
      );
      if (Either.isLeft(result)) {
        return {
          status: 500,
          response: { error: result.left.message },
        } as const satisfies ControllerResponse;
      }
      return {
        status: 200,
        response: result.right,
      } as const satisfies ControllerResponse;
    });

  const stopTask = (options: { taskId: string }) =>
    Effect.gen(function* () {
      const result = yield* Effect.either(tskService.stopTask(options.taskId));
      if (Either.isLeft(result)) {
        return {
          status: 500,
          response: { error: result.left.message },
        } as const satisfies ControllerResponse;
      }
      return {
        status: 200,
        response: result.right,
      } as const satisfies ControllerResponse;
    });

  const continueTask = (options: { taskId: string }) =>
    Effect.gen(function* () {
      const result = yield* Effect.either(
        tskService.continueTask(options.taskId),
      );
      if (Either.isLeft(result)) {
        return {
          status: 500,
          response: { error: result.left.message },
        } as const satisfies ControllerResponse;
      }
      tskService.launchClaudeWhenReady(options.taskId);
      return {
        status: 200,
        response: result.right,
      } as const satisfies ControllerResponse;
    });

  const renameTask = (options: { taskId: string; name: string }) =>
    Effect.gen(function* () {
      const result = yield* Effect.either(
        tskService.renameTask(options.taskId, options.name),
      );
      if (Either.isLeft(result)) {
        return {
          status: 500,
          response: { error: result.left.message },
        } as const satisfies ControllerResponse;
      }
      return {
        status: 200,
        response: result.right,
      } as const satisfies ControllerResponse;
    });

  const suggestName = (options: { taskId: string }) =>
    Effect.gen(function* () {
      const result = yield* Effect.either(
        tskService.suggestName(options.taskId),
      );
      if (Either.isLeft(result)) {
        return {
          status: 500,
          response: { error: result.left.message },
        } as const satisfies ControllerResponse;
      }
      return {
        status: 200,
        response: result.right,
      } as const satisfies ControllerResponse;
    });

  const openPath = (options: { path: string; target: "explorer" | "vscode" }) =>
    Effect.gen(function* () {
      const result = yield* Effect.either(
        tskService.openPath(options.path, options.target),
      );
      if (Either.isLeft(result)) {
        return {
          status: 500,
          response: { error: result.left.message },
        } as const satisfies ControllerResponse;
      }
      return {
        status: 200,
        response: result.right,
      } as const satisfies ControllerResponse;
    });

  const getServiceDisplayConfig = (options: { projectPath: string }) =>
    Effect.gen(function* () {
      const config = yield* serviceDisplayConfigService.getConfig(
        options.projectPath,
      );
      return {
        status: 200,
        response: { services: config },
      } as const satisfies ControllerResponse;
    });

  const updateServiceDisplayConfig = (options: {
    projectPath: string;
    services: Record<string, ServiceDisplayConfig>;
  }) =>
    Effect.gen(function* () {
      const result = yield* Effect.either(
        serviceDisplayConfigService.saveConfig(
          options.projectPath,
          options.services,
        ),
      );
      if (Either.isLeft(result)) {
        return {
          status: 500,
          response: { error: "Failed to save service display config" },
        } as const satisfies ControllerResponse;
      }
      return {
        status: 200,
        response: { success: true },
      } as const satisfies ControllerResponse;
    });

  return {
    listTasks,
    getTaskTranscript,
    createTask,
    deleteTask,
    stopTask,
    continueTask,
    renameTask,
    suggestName,
    openPath,
    getServiceDisplayConfig,
    updateServiceDisplayConfig,
  };
});

export type ITskController = InferEffect<typeof LayerImpl>;
export class TskController extends Context.Tag("TskController")<
  TskController,
  ITskController
>() {
  static Live = Layer.effect(this, LayerImpl);
}
