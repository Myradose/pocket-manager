import { FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { describe, expect, test } from "vitest";
import { testPlatformLayer } from "../../../../testing/layers/testPlatformLayer";
import { TskService } from "./TskService";

describe("TskService", () => {
  describe("generateServeHostname", () => {
    const testLayer = TskService.Live.pipe(
      Layer.provide(NodeContext.layer),
      Layer.provide(testPlatformLayer()),
    );

    test("uses task name as hostname (matching tsk Traefik routing)", async () => {
      const service = await Effect.runPromise(
        TskService.pipe(Effect.provide(testLayer)),
      );

      const result = service.generateServeHostname(
        "better-puffin",
        "better-puffin",
      );
      expect(result).toBe("better-puffin");
    });

    test("sanitizes special characters to dashes", async () => {
      const service = await Effect.runPromise(
        TskService.pipe(Effect.provide(testLayer)),
      );

      const result = service.generateServeHostname("My Task", "abcdef1234");
      expect(result).toBe("my-task");
    });

    test("collapses consecutive dashes", async () => {
      const service = await Effect.runPromise(
        TskService.pipe(Effect.provide(testLayer)),
      );

      const result = service.generateServeHostname(
        "Hello World! @#$",
        "12345678",
      );
      expect(result).toBe("hello-world");
    });
  });

  describe("enrichTask", () => {
    const testLayer = TskService.Live.pipe(
      Layer.provide(NodeContext.layer),
      Layer.provide(testPlatformLayer()),
    );

    test("enriches task with transcript dir and URLs", async () => {
      const service = await Effect.runPromise(
        TskService.pipe(Effect.provide(testLayer)),
      );

      const task = {
        id: "abc12345",
        name: "test-task",
        status: "SERVING",
        repo_root: "/tmp/repo",
        project: "test",
        branch_name: "tsk/abc12345",
        created_at: "2026-01-01T00:00:00Z",
        started_at: "2026-01-01T00:00:01Z",
      };

      const services = {
        frontend: { port: 4200, path: "/" },
        vnc: { port: 6080, path: "/vnc" },
      };

      const result = service.enrichTask(
        task,
        "/tmp/tasks/hash-abc12345",
        services,
        [],
      );

      expect(result.transcripts_dir).toBe(
        "/tmp/tasks/hash-abc12345/transcripts",
      );
      expect(result.frontend_url).toBe("http://test-task.localhost:8080/");
      expect(result.vnc_url).toBe("http://test-task.localhost:8080/vnc");
    });

    test("handles missing services", async () => {
      const service = await Effect.runPromise(
        TskService.pipe(Effect.provide(testLayer)),
      );

      const task = {
        id: "abc12345",
        name: "test-task",
        status: "RUNNING",
        repo_root: "/tmp/repo",
        project: "test",
        branch_name: "tsk/abc12345",
        created_at: "2026-01-01T00:00:00Z",
        started_at: null,
      };

      const result = service.enrichTask(task, "", {}, []);

      expect(result.transcripts_dir).toBe("");
      expect(result.frontend_url).toBeUndefined();
      expect(result.vnc_url).toBeUndefined();
    });
  });

  describe("listTasks", () => {
    test("returns empty array when tasks file does not exist", async () => {
      const mockFs = FileSystem.layerNoop({
        exists: () => Effect.succeed(false),
      });

      const testLayer = TskService.Live.pipe(
        Layer.provide(mockFs),
        Layer.provide(testPlatformLayer()),
      );

      const service = await Effect.runPromise(
        TskService.pipe(Effect.provide(testLayer)),
      );

      const result = await Effect.runPromise(service.listTasks());

      expect(result).toEqual([]);
    });
  });

  describe("getTaskTranscript", () => {
    test("returns empty conversations when task dir does not exist", async () => {
      const mockFs = FileSystem.layerNoop({
        exists: () => Effect.succeed(false),
      });

      const testLayer = TskService.Live.pipe(
        Layer.provide(mockFs),
        Layer.provide(testPlatformLayer()),
      );

      const service = await Effect.runPromise(
        TskService.pipe(Effect.provide(testLayer)),
      );

      const result = await Effect.runPromise(
        service.getTaskTranscript("nonexistent"),
      );

      expect(result.conversations).toEqual([]);
    });
  });
});
