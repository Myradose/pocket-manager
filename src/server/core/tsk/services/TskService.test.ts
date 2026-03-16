import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { TskService } from "./TskService";

describe("TskService", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("listTasks", () => {
    test("returns enriched tasks from tsk API", async () => {
      const mockFetch = vi.fn();

      // First call: GET /tasks
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tasks: [
            {
              id: "pliable-klipspringer",
              name: "test-task",
              status: "SERVING",
              repo_root: "/tmp/repo",
              project: "test",
              branch_name: "tsk/pliable-klipspringer",
              created_at: "2026-01-01T00:00:00Z",
              started_at: "2026-01-01T00:00:01Z",
              task_dir: "/tmp/tasks/hash-pliable-klipspringer",
              serve_hostname: "pliable-klipspringer",
            },
          ],
        }),
      });

      // Second call: GET /repo-info
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          services: {
            frontend: { port: 4200, path: "/" },
            vnc: { port: 6080, path: "/vnc" },
          },
          submodules: ["libs/core"],
        }),
      });

      vi.stubGlobal("fetch", mockFetch);

      const service = await Effect.runPromise(
        TskService.pipe(Effect.provide(TskService.Live)),
      );

      const result = await Effect.runPromise(service.listTasks());

      expect(result).toHaveLength(1);
      const task = result[0];
      expect(task).toBeDefined();
      if (!task) return;
      expect(task.id).toBe("pliable-klipspringer");
      expect(task.transcripts_dir).toBe(
        "/tmp/tasks/hash-pliable-klipspringer/transcripts",
      );
      expect(task.services).toEqual([
        {
          key: "frontend",
          url: "http://pliable-klipspringer.localhost:8080/",
          port: 4200,
          path: "/",
        },
        {
          key: "vnc",
          url: "http://pliable-klipspringer.localhost:8080/vnc",
          port: 6080,
          path: "/vnc",
        },
      ]);
      expect(task.submodules).toEqual(["libs/core"]);
    });

    test("returns empty array when API is unreachable", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
      vi.stubGlobal("fetch", mockFetch);

      const service = await Effect.runPromise(
        TskService.pipe(Effect.provide(TskService.Live)),
      );

      const result = await Effect.runPromise(service.listTasks());

      expect(result).toEqual([]);
    });

    test("non-serve tasks have no frontend/vnc URLs", async () => {
      const mockFetch = vi.fn();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tasks: [
            {
              id: "calm-badger",
              name: "test-task",
              status: "RUNNING",
              repo_root: "/tmp/repo",
              project: "test",
              branch_name: "tsk/calm-badger",
              created_at: "2026-01-01T00:00:00Z",
              started_at: null,
              // no serve_hostname, no task_dir
            },
          ],
        }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          services: { frontend: { port: 4200, path: "/" } },
          submodules: [],
        }),
      });

      vi.stubGlobal("fetch", mockFetch);

      const service = await Effect.runPromise(
        TskService.pipe(Effect.provide(TskService.Live)),
      );

      const result = await Effect.runPromise(service.listTasks());

      expect(result).toHaveLength(1);
      const task = result[0];
      expect(task).toBeDefined();
      if (!task) return;
      expect(task.services).toEqual([]);
      expect(task.transcripts_dir).toBe("");
    });
  });

  describe("getTaskTranscript", () => {
    test("returns conversations from tsk API", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          conversations: [
            { type: "user", message: { content: "hello" } },
            { type: "assistant", message: { content: "hi" } },
          ],
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const service = await Effect.runPromise(
        TskService.pipe(Effect.provide(TskService.Live)),
      );

      const result = await Effect.runPromise(
        service.getTaskTranscript("task1"),
      );

      expect(result.conversations).toHaveLength(2);
    });

    test("returns empty conversations when API fails", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
      vi.stubGlobal("fetch", mockFetch);

      const service = await Effect.runPromise(
        TskService.pipe(Effect.provide(TskService.Live)),
      );

      const result = await Effect.runPromise(
        service.getTaskTranscript("nonexistent"),
      );

      expect(result.conversations).toEqual([]);
    });
  });
});
