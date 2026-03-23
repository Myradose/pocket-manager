import { Effect, Layer } from "effect";
import { describe, expect, test } from "vitest";
import { ServiceDisplayConfigService } from "../services/ServiceDisplayConfigService";
import { TskService } from "../services/TskService";
import { TskController } from "./TskController";

const mockTskServiceLayer = Layer.mock(TskService, {
  listTasks: () =>
    Effect.succeed([
      {
        id: "task1",
        name: "Test Task",
        status: "SERVING",
        repo_root: "/tmp/repo",
        project: "test",
        branch_name: "tsk/task1",
        created_at: "2026-01-01T00:00:00Z",
        started_at: "2026-01-01T00:00:01Z",
        transcripts_dir: "/tmp/tasks/hash-task1/transcripts",
        services: [
          {
            key: "frontend",
            url: "http://task1.localhost:8080/",
            port: 4200,
            path: "/",
          },
        ],
      },
    ]),
  getTaskTranscript: () =>
    Effect.succeed({
      conversations: [{ type: "user", message: { content: "hello" } }],
    }),
  createTask: () => Effect.succeed({ id: "new-task", status: "QUEUED" }),
  deleteTask: () => Effect.succeed({ success: true }),
  stopTask: () => Effect.succeed({ success: true }),
  continueTask: () => Effect.succeed({ id: "task1", status: "QUEUED" }),
  launchClaudeWhenReady: () => undefined,
});

const mockServiceDisplayConfigLayer = Layer.mock(ServiceDisplayConfigService, {
  getConfig: () => Effect.succeed(null),
  saveConfig: () => Effect.succeed(undefined),
});

const testLayer = TskController.Live.pipe(
  Layer.provide(mockTskServiceLayer),
  Layer.provide(mockServiceDisplayConfigLayer),
);

describe("TskController", () => {
  test("listTasks returns 200 with tasks", async () => {
    const controller = await Effect.runPromise(
      TskController.pipe(Effect.provide(testLayer)),
    );

    const result = await Effect.runPromise(controller.listTasks());

    expect(result.status).toBe(200);
    expect(Array.isArray(result.response)).toBe(true);
  });

  test("getTaskTranscript returns 200 with conversations", async () => {
    const controller = await Effect.runPromise(
      TskController.pipe(Effect.provide(testLayer)),
    );

    const result = await Effect.runPromise(
      controller.getTaskTranscript({ taskId: "task1" }),
    );

    expect(result.status).toBe(200);
  });

  test("createTask returns 200 on success", async () => {
    const controller = await Effect.runPromise(
      TskController.pipe(Effect.provide(testLayer)),
    );

    const result = await Effect.runPromise(
      controller.createTask({ name: "test", repo_path: "/tmp/repo" }),
    );

    expect(result.status).toBe(200);
  });

  test("deleteTask returns 200 on success", async () => {
    const controller = await Effect.runPromise(
      TskController.pipe(Effect.provide(testLayer)),
    );

    const result = await Effect.runPromise(
      controller.deleteTask({ taskId: "task1" }),
    );

    expect(result.status).toBe(200);
  });
});
