import { Effect, Layer } from "effect";
import { describe, expect, test } from "vitest";
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
        frontend_url: "http://test-task-task1.localhost:8080/",
        vnc_url: "http://test-task-task1.localhost:8080/vnc",
      },
    ]),
  getTaskTranscript: () =>
    Effect.succeed({
      conversations: [{ type: "user", message: { content: "hello" } }],
    }),
  createTask: () => Effect.succeed({ id: "new-task", status: "QUEUED" }),
  deleteTask: () => Effect.succeed({ success: true }),
});

const testLayer = TskController.Live.pipe(Layer.provide(mockTskServiceLayer));

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
