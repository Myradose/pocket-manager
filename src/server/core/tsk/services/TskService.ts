import { Context, Data, Effect, Layer } from "effect";
import type { InferEffect } from "../../../lib/effect/types";
import type { CreateTaskRequest, TskTaskResponse } from "../schema";

class TskApiError extends Data.TaggedError("TskApiError")<{
  message: string;
}> {}

type RawTask = {
  id: string;
  name: string;
  name_source?: string;
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

const getTraefikPort = () =>
  Effect.sync(() => {
    // biome-ignore lint/style/noProcessEnv: TRAEFIK_PORT is not in EnvSchema
    const portStr = process.env.TRAEFIK_PORT;
    if (portStr) {
      const parsed = parseInt(portStr, 10);
      if (!Number.isNaN(parsed)) return parsed;
    }
    return 8080;
  });

/**
 * Fire-and-forget: poll until a task's container is ready, then launch Claude
 * in a tmux session inside the container.
 */
const launchClaudeWhenReady = (taskId: string, description?: string) => {
  (async () => {
    const port = await Effect.runPromise(getTskApiPort());
    const MAX_ATTEMPTS = 30;

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const resp = await fetch(`http://localhost:${port}/tasks?limit=1000`);
        if (!resp.ok) continue;
        const data = (await resp.json()) as { tasks: RawTask[] };
        const task = data.tasks?.find((t) => t.id === taskId);
        if (!task?.container_id) continue;

        const cid = task.container_id;
        const { execSync } = await import("node:child_process");

        // Ensure "claude" tmux session exists
        try {
          execSync(`docker exec ${cid} tmux has-session -t claude`, {
            timeout: 5000,
          });
        } catch {
          execSync(
            `docker exec ${cid} tmux new-session -d -s claude -x 200 -y 50`,
            { timeout: 5000 },
          );
        }

        // Only send command if the pane is running a shell (not already running claude)
        const paneCmd = execSync(
          `docker exec ${cid} tmux list-panes -t claude -F "#{pane_current_command}"`,
          { encoding: "utf-8", timeout: 5000 },
        ).trim();

        if (paneCmd === "bash" || paneCmd === "sh" || paneCmd === "zsh") {
          if (description) {
            // Pipe prompt to a file inside the container via stdin (no shell escaping needed)
            execSync(
              `docker exec -i ${cid} sh -c 'cat > /tmp/.claude-prompt'`,
              { input: description, timeout: 5000 },
            );
            execSync(
              `docker exec ${cid} tmux send-keys -t claude 'claude "$(cat /tmp/.claude-prompt)"' Enter`,
              { timeout: 5000 },
            );
          } else {
            execSync(
              `docker exec ${cid} tmux send-keys -t claude "claude" Enter`,
              { timeout: 5000 },
            );
          }
        }
        return;
      } catch {}
    }
  })();
};

const LayerImpl = Effect.gen(function* () {
  const listTasks = (options?: { repo?: string }) =>
    Effect.tryPromise({
      try: async () => {
        const port = await Effect.runPromise(getTskApiPort());
        const params = new URLSearchParams({ limit: "1000" });
        if (options?.repo) params.set("repo", options.repo);
        const resp = await fetch(`http://localhost:${port}/tasks?${params}`);
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

        const traefikPort = await Effect.runPromise(getTraefikPort());

        return tasks.map((task): TskTaskResponse => {
          const repoInfo = repoInfoCache.get(task.repo_root);
          const services = repoInfo?.services ?? {};
          const submodules = repoInfo?.submodules ?? [];

          const hostname = task.serve_hostname;
          const resolvedServices = hostname
            ? Object.entries(services).map(([key, config]) => ({
                key,
                url: `http://${hostname}.localhost:${traefikPort}${config.url ?? config.path ?? "/"}`,
                port: config.port,
                path: config.path,
              }))
            : [];

          return {
            ...task,
            transcripts_dir: task.task_dir
              ? `${task.task_dir}/transcripts`
              : "",
            services: resolvedServices,
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
          const errorBody = await response.text();
          throw new Error(`tsk API returned ${response.status}: ${errorBody}`);
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

  const continueTask = (taskId: string) =>
    Effect.tryPromise({
      try: async () => {
        const port = await Effect.runPromise(getTskApiPort());
        const response = await fetch(
          `http://localhost:${port}/tasks/${taskId}/continue`,
          { method: "POST" },
        );
        if (!response.ok) {
          throw new Error(`tsk API returned ${response.status}`);
        }
        return (await response.json()) as object;
      },
      catch: (error) =>
        new TskApiError({
          message:
            error instanceof Error ? error.message : "Failed to continue task",
        }),
    });

  const renameTask = (taskId: string, name: string) =>
    Effect.tryPromise({
      try: async () => {
        const port = await Effect.runPromise(getTskApiPort());
        const response = await fetch(
          `http://localhost:${port}/tasks/${taskId}/rename`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
          },
        );
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(data.error ?? `tsk API returned ${response.status}`);
        }
        return (await response.json()) as RawTask;
      },
      catch: (error) =>
        new TskApiError({
          message:
            error instanceof Error ? error.message : "Failed to rename task",
        }),
    });

  const suggestName = (taskId: string) =>
    Effect.tryPromise({
      try: async () => {
        const port = await Effect.runPromise(getTskApiPort());
        const response = await fetch(
          `http://localhost:${port}/tasks/${taskId}/suggest-name`,
          { method: "POST" },
        );
        if (!response.ok) {
          if (response.status === 404) return { name: null };
          throw new Error(`tsk API returned ${response.status}`);
        }
        return (await response.json()) as { name: string | null };
      },
      catch: (error) =>
        new TskApiError({
          message:
            error instanceof Error ? error.message : "Failed to suggest name",
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
    continueTask,
    renameTask,
    suggestName,
    openPath,
    launchClaudeWhenReady,
  };
});

export type ITskService = InferEffect<typeof LayerImpl>;
export class TskService extends Context.Tag("TskService")<
  TskService,
  ITskService
>() {
  static Live = Layer.effect(this, LayerImpl);
}
