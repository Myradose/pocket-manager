import { Effect } from "effect";
import { describe, expect, test, vi } from "vitest";
import { TerminalSessionService } from "./TerminalSessionService";

// Mock node-pty since it's a native addon not available in test
vi.mock("node-pty", () => ({
  spawn: () => ({
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
  }),
}));

const testLayer = TerminalSessionService.Live;

describe("TerminalSessionService", () => {
  test("createSession returns sessionId", async () => {
    const service = await Effect.runPromise(
      TerminalSessionService.pipe(Effect.provide(testLayer)),
    );

    const result = await Effect.runPromise(
      service.createSession("task1", "container1"),
    );

    expect(result.sessionId).toBeDefined();
    expect(typeof result.sessionId).toBe("string");
  });

  test("getSession returns session after creation", async () => {
    const service = await Effect.runPromise(
      TerminalSessionService.pipe(Effect.provide(testLayer)),
    );

    const { sessionId } = await Effect.runPromise(
      service.createSession("task2", "container2"),
    );

    const session = await Effect.runPromise(service.getSession(sessionId));

    expect(session).not.toBeNull();
    expect(session?.taskId).toBe("task2");
    expect(session?.containerId).toBe("container2");
  });

  test("getSession returns null for unknown session", async () => {
    const service = await Effect.runPromise(
      TerminalSessionService.pipe(Effect.provide(testLayer)),
    );

    const session = await Effect.runPromise(service.getSession("nonexistent"));
    expect(session).toBeNull();
  });

  test("destroySession removes the session", async () => {
    const service = await Effect.runPromise(
      TerminalSessionService.pipe(Effect.provide(testLayer)),
    );

    const { sessionId } = await Effect.runPromise(
      service.createSession("task3", "container3"),
    );

    await Effect.runPromise(service.destroySession(sessionId));
    const session = await Effect.runPromise(service.getSession(sessionId));

    expect(session).toBeNull();
  });

  test("listSessions returns all active sessions", async () => {
    const service = await Effect.runPromise(
      TerminalSessionService.pipe(Effect.provide(testLayer)),
    );

    await Effect.runPromise(service.createSession("task4", "container4"));
    await Effect.runPromise(service.createSession("task5", "container5"));

    const sessions = await Effect.runPromise(service.listSessions());

    // At least the 2 we just created (may include others from previous tests)
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    expect(sessions.some((s) => s.taskId === "task4")).toBe(true);
    expect(sessions.some((s) => s.taskId === "task5")).toBe(true);
  });
});
