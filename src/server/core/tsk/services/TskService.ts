import { Context, Data, Effect, Layer } from "effect";
import type { InferEffect } from "../../../lib/effect/types";
import type { CreateTaskRequest, TskTaskResponse } from "../schema";

class TskApiError extends Data.TaggedError("TskApiError")<{
  message: string;
}> {}

type RawTask = {
  id: string;
  name: string;
  status: string;
  repo_root: string;
  project: string;
  branch_name: string;
  created_at: string;
  started_at: string | null;
  container_id?: string;
  copied_repo_path?: string;
  task_dir?: string;
  serve_hostname?: string;
};

type RepoInfoResponse = {
  services: Record<string, { port: number; path: string; url?: string }>;
  submodules: string[];
};

const getTskApiPort = () =>
  Effect.sync(() => {
    // biome-ignore lint/style/noProcessEnv: TSK_API_PORT is not in EnvSchema
    const portStr = process.env.TSK_API_PORT;
    if (portStr) {
      const parsed = parseInt(portStr, 10);
      if (!Number.isNaN(parsed)) return parsed;
    }
    return 7354;
  });

const LayerImpl = Effect.gen(function* () {
  const listTasks = () =>
    Effect.tryPromise({
      try: async () => {
        const port = await Effect.runPromise(getTskApiPort());
        const resp = await fetch(`http://localhost:${port}/tasks?limit=1000`);
        if (!resp.ok) return [] satisfies TskTaskResponse[];

        const data = (await resp.json()) as { tasks: RawTask[] };
        const tasks = data.tasks;

        // Fetch repo-info per unique repo_root
        const repoInfoCache = new Map<string, RepoInfoResponse>();
        const uniqueRoots = [...new Set(tasks.map((t) => t.repo_root))];
        await Promise.all(
          uniqueRoots.map(async (repoRoot) => {
            try {
              const infoResp = await fetch(
                `http://localhost:${port}/repo-info?path=${encodeURIComponent(repoRoot)}`,
              );
              if (infoResp.ok) {
                const info = (await infoResp.json()) as RepoInfoResponse;
                repoInfoCache.set(repoRoot, info);
              }
            } catch {
              // ignore — will use empty defaults
            }
          }),
        );

        const traefikPort = 8080;

        return tasks.map((task): TskTaskResponse => {
          const repoInfo = repoInfoCache.get(task.repo_root);
          const services = repoInfo?.services ?? {};
          const submodules = repoInfo?.submodules ?? [];

          const hostname = task.serve_hostname;
          let frontendUrl: string | undefined;
          let vncUrl: string | undefined;

          if (hostname) {
            const frontendService = services.frontend ?? services.web;
            if (frontendService) {
              const displayPath =
                frontendService.url ?? frontendService.path ?? "/";
              frontendUrl = `http://${hostname}.localhost:${traefikPort}${displayPath}`;
            }

            const vncService = services.vnc;
            if (vncService) {
              const displayPath = vncService.url ?? vncService.path ?? "/vnc";
              vncUrl = `http://${hostname}.localhost:${traefikPort}${displayPath}`;
            }
          }

          return {
            ...task,
            transcripts_dir: task.task_dir
              ? `${task.task_dir}/transcripts`
              : "",
            frontend_url: frontendUrl,
            vnc_url: vncUrl,
            submodules: submodules.length > 0 ? submodules : undefined,
          };
        });
      },
      catch: () => new TskApiError({ message: "Failed to list tasks" }),
    }).pipe(Effect.catchAll(() => Effect.succeed([] as TskTaskResponse[])));

  const getTaskTranscript = (taskId: string) =>
    Effect.gen(function* () {
      const port = yield* getTskApiPort();
      const result = yield* Effect.tryPromise({
        try: async () => {
          const resp = await fetch(
            `http://localhost:${port}/tasks/${taskId}/transcript`,
          );
          if (!resp.ok) return { conversations: [] };
          const data = await resp.json();
          return { conversations: data.conversations ?? [] };
        },
        catch: () => new TskApiError({ message: "Failed to fetch transcript" }),
      });
      return result;
    }).pipe(Effect.catchAll(() => Effect.succeed({ conversations: [] })));

  const createTask = (request: CreateTaskRequest) =>
    Effect.tryPromise({
      try: async () => {
        const port = await Effect.runPromise(getTskApiPort());
        const body = {
          ...request,
          name: request.name || "shell",
        };
        const response = await fetch(`http://localhost:${port}/tasks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          throw new Error(`tsk API returned ${response.status}`);
        }
        return (await response.json()) as object;
      },
      catch: (error) =>
        new TskApiError({
          message:
            error instanceof Error ? error.message : "Failed to create task",
        }),
    });

  const deleteTask = (taskId: string) =>
    Effect.tryPromise({
      try: async () => {
        const port = await Effect.runPromise(getTskApiPort());
        const response = await fetch(
          `http://localhost:${port}/tasks/${taskId}`,
          { method: "DELETE" },
        );
        if (!response.ok) {
          throw new Error(`tsk API returned ${response.status}`);
        }
        return { success: true };
      },
      catch: (error) =>
        new TskApiError({
          message:
            error instanceof Error ? error.message : "Failed to delete task",
        }),
    });

  const stopTask = (taskId: string) =>
    Effect.tryPromise({
      try: async () => {
        const port = await Effect.runPromise(getTskApiPort());
        const response = await fetch(
          `http://localhost:${port}/tasks/${taskId}/stop`,
          { method: "POST" },
        );
        if (!response.ok) {
          throw new Error(`tsk API returned ${response.status}`);
        }
        return { success: true };
      },
      catch: (error) =>
        new TskApiError({
          message:
            error instanceof Error ? error.message : "Failed to stop task",
        }),
    });

  const openPath = (filePath: string, target: "explorer" | "vscode") =>
    Effect.tryPromise({
      try: async () => {
        const { spawn } = await import("node:child_process");

        if (target === "vscode") {
          spawn("code", [filePath], { stdio: "ignore" });
          return { success: true };
        }

        // Detect WSL for explorer
        const isWsl = await import("node:fs")
          .then((fsMod) => fsMod.promises.readFile("/proc/version", "utf-8"))
          .then((v) => v.includes("microsoft") || v.includes("Microsoft"))
          .catch(() => false);

        const openers =
          process.platform === "darwin"
            ? ["open"]
            : isWsl
              ? ["wslview", "explorer.exe"]
              : ["xdg-open"];

        for (const cmd of openers) {
          try {
            spawn(cmd, [filePath], { stdio: "ignore" });
            return { success: true };
          } catch {}
        }
        throw new Error("No file opener found");
      },
      catch: (error) =>
        new TskApiError({
          message:
            error instanceof Error ? error.message : "Failed to open path",
        }),
    });

  return {
    listTasks,
    getTaskTranscript,
    createTask,
    deleteTask,
    stopTask,
    openPath,
  };
});

export type ITskService = InferEffect<typeof LayerImpl>;
export class TskService extends Context.Tag("TskService")<
  TskService,
  ITskService
>() {
  static Live = Layer.effect(this, LayerImpl);
}
