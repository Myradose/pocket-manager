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
        services: [
          {
            key: "frontend",
            url: "http://test.localhost:8080/",
            port: 4200,
            path: "/",
          },
          {
            key: "vnc",
            url: "http://test.localhost:8080/vnc",
            port: 6080,
            path: "/vnc",
          },
        ],
      },
    ]),
  getTaskTranscript: () => Effect.succeed({ conversations: [] }),
  createTask: () => Effect.succeed({ id: "new-task", status: "QUEUED" }),
  deleteTask: () => Effect.succeed({ success: true }),
  stopTask: () => Effect.succeed({ success: true }),
  continueTask: () => Effect.succeed({ id: "task1", status: "QUEUED" }),
});

const mockTerminalSessionServiceLayer = Layer.mock(TerminalSessionService, {
  listTmuxSessions: () => Effect.succeed(["claude", "shell-1"]),
  ensureTmuxSession: () => Effect.succeed({ name: "claude", created: false }),
  destroyTmuxSession: () => Effect.succeed(undefined),
  attachPty: () =>
    Effect.succeed({
      containerId: "abc123container",
      tmuxSessionName: "claude",
      taskId: "task1",
      pty: {},
      dataListeners: new Map(),
    }),
  getPtyAttachment: () => Effect.succeed(null),
  detachPty: () => Effect.succeed(undefined),
  markPtyForCleanup: () => Effect.succeed(undefined),
  cancelPtyCleanup: () => Effect.succeed(undefined),
});

const testLayer = TerminalController.Live.pipe(
  Layer.provide(mockTskServiceLayer),
  Layer.provide(mockTerminalSessionServiceLayer),
);

describe("TerminalController", () => {
  test("ensureTerminal returns 200 for valid task", async () => {
    const controller = await Effect.runPromise(
      TerminalController.pipe(Effect.provide(testLayer)),
    );

    const result = await Effect.runPromise(
      controller.ensureTerminal({ taskId: "task1", name: "claude" }),
    );

    expect(result.status).toBe(200);
  });

  test("ensureTerminal returns 404 for unknown task", async () => {
    const controller = await Effect.runPromise(
      TerminalController.pipe(Effect.provide(testLayer)),
    );

    const result = await Effect.runPromise(
      controller.ensureTerminal({ taskId: "nonexistent", name: "claude" }),
    );

    expect(result.status).toBe(404);
  });

  test("listTerminals returns 200 with sessions", async () => {
    const controller = await Effect.runPromise(
      TerminalController.pipe(Effect.provide(testLayer)),
    );

    const result = await Effect.runPromise(
      controller.listTerminals({ taskId: "task1" }),
    );

    expect(result.status).toBe(200);
    expect(Array.isArray(result.response)).toBe(true);
  });

  test("destroyTerminal returns 200", async () => {
    const controller = await Effect.runPromise(
      TerminalController.pipe(Effect.provide(testLayer)),
    );

    const result = await Effect.runPromise(
      controller.destroyTerminal({ taskId: "task1", name: "claude" }),
    );

    expect(result.status).toBe(200);
  });
});
