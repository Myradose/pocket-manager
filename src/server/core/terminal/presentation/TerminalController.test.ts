import { Effect, Layer } from "effect";
import { describe, expect, test } from "vitest";
import { TskService } from "../../tsk/services/TskService";
import { TerminalSessionService } from "../services/TerminalSessionService";
import { TerminalController } from "./TerminalController";

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
        container_id: "abc123container",
        transcripts_dir: "/tmp/tasks/hash-task1/transcripts",
        frontend_url: "http://test.localhost:8080/",
        vnc_url: "http://test.localhost:8080/vnc",
      },
    ]),
  getTaskTranscript: () => Effect.succeed({ conversations: [] }),
  createTask: () => Effect.succeed({ id: "new-task", status: "QUEUED" }),
  deleteTask: () => Effect.succeed({ success: true }),
  generateServeHostname: () => "test",
  enrichTask: () => ({
    id: "task1",
    name: "Test",
    status: "SERVING",
    repo_root: "/tmp",
    project: "test",
    branch_name: "tsk/task1",
    created_at: "",
    started_at: null,
    transcripts_dir: "",
  }),
});

const mockTerminalSessionServiceLayer = Layer.mock(TerminalSessionService, {
  createSession: () => Effect.succeed({ sessionId: "session-123" }),
  getSession: () => Effect.succeed(null),
  destroySession: () => Effect.succeed(undefined),
  listSessions: () =>
    Effect.succeed([
      {
        id: "session-123",
        taskId: "task1",
        containerId: "abc123container",
        label: undefined,
        createdAt: "2026-01-01T00:00:00Z",
      },
    ]),
  markForCleanup: () => Effect.succeed(undefined),
  cancelCleanup: () => Effect.succeed(undefined),
  updateActivity: () => Effect.succeed(undefined),
  cleanupIdleSessions: () => Effect.succeed(undefined),
});

const testLayer = TerminalController.Live.pipe(
  Layer.provide(mockTskServiceLayer),
  Layer.provide(mockTerminalSessionServiceLayer),
);

describe("TerminalController", () => {
  test("createTerminal returns 200 with sessionId for valid task", async () => {
    const controller = await Effect.runPromise(
      TerminalController.pipe(Effect.provide(testLayer)),
    );

    const result = await Effect.runPromise(
      controller.createTerminal({ taskId: "task1" }),
    );

    expect(result.status).toBe(200);
  });

  test("createTerminal returns 404 for unknown task", async () => {
    const controller = await Effect.runPromise(
      TerminalController.pipe(Effect.provide(testLayer)),
    );

    const result = await Effect.runPromise(
      controller.createTerminal({ taskId: "nonexistent" }),
    );

    expect(result.status).toBe(404);
  });

  test("listTerminals returns 200 with sessions", async () => {
    const controller = await Effect.runPromise(
      TerminalController.pipe(Effect.provide(testLayer)),
    );

    const result = await Effect.runPromise(controller.listTerminals());

    expect(result.status).toBe(200);
    expect(Array.isArray(result.response)).toBe(true);
  });

  test("destroyTerminal returns 200", async () => {
    const controller = await Effect.runPromise(
      TerminalController.pipe(Effect.provide(testLayer)),
    );

    const result = await Effect.runPromise(
      controller.destroyTerminal({ sessionId: "session-123" }),
    );

    expect(result.status).toBe(200);
  });
});
