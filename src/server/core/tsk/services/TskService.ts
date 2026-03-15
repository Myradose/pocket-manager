import { FileSystem, Path } from "@effect/platform";
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
};

const getHomeDir = () =>
  Effect.sync(() => {
    // biome-ignore lint/style/noProcessEnv: HOME is not in EnvSchema
    return process.env.HOME ?? process.env.USERPROFILE ?? "";
  });

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
  const fs = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;

  const generateServeHostname = (taskName: string, _taskId: string): string => {
    return taskName
      .split("")
      .map((c) => (/[a-zA-Z0-9]/.test(c) ? c.toLowerCase() : "-"))
      .join("")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-");
  };

  const parseToml = (content: string) =>
    Effect.tryPromise({
      try: async () => {
        const toml = await import("toml");
        return toml.parse(content) as {
          services?: Record<
            string,
            { port: number; path: string; url?: string }
          >;
        };
      },
      catch: () => new TskApiError({ message: "Failed to parse TOML" }),
    });

  const loadProjectConfig = (repoRoot: string) =>
    Effect.gen(function* () {
      const configPath = pathService.join(repoRoot, ".tsk", "project.toml");
      const exists = yield* fs.exists(configPath);
      if (!exists) return {};

      const content = yield* fs.readFileString(configPath);
      const parsed = yield* parseToml(content);
      return parsed.services ?? {};
    }).pipe(
      Effect.catchAll(() =>
        Effect.succeed(
          {} as Record<string, { port: number; path: string; url?: string }>,
        ),
      ),
    );

  const enrichTask = (
    task: RawTask,
    taskDir: string,
    services: Record<string, { port: number; path: string; url?: string }>,
  ): TskTaskResponse => {
    const hostname = generateServeHostname(task.name, task.id);
    const traefikPort = 8080;

    let frontendUrl: string | undefined;
    let vncUrl: string | undefined;

    const frontendService = services.frontend ?? services.web;
    if (frontendService) {
      const displayPath = frontendService.url ?? frontendService.path ?? "/";
      frontendUrl = `http://${hostname}.localhost:${traefikPort}${displayPath}`;
    }

    const vncService = services.vnc;
    if (vncService) {
      const displayPath = vncService.url ?? vncService.path ?? "/vnc";
      vncUrl = `http://${hostname}.localhost:${traefikPort}${displayPath}`;
    }

    return {
      ...task,
      transcripts_dir: taskDir ? `${taskDir}/transcripts` : "",
      frontend_url: frontendUrl,
      vnc_url: vncUrl,
    };
  };

  const listTasks = () =>
    Effect.gen(function* () {
      const homeDir = yield* getHomeDir();
      const tasksFile = pathService.join(
        homeDir,
        ".local",
        "share",
        "tsk",
        "tasks.json",
      );
      const tasksBaseDir = pathService.join(
        homeDir,
        ".local",
        "share",
        "tsk",
        "tasks",
      );

      const tasksFileExists = yield* fs.exists(tasksFile);
      if (!tasksFileExists) return [] as TskTaskResponse[];

      const content = yield* fs.readFileString(tasksFile);
      const tasks = JSON.parse(content) as RawTask[];

      const tasksDirExists = yield* fs.exists(tasksBaseDir);
      const taskDirMap = new Map<string, string>();

      if (tasksDirExists) {
        const taskDirs = yield* fs.readDirectory(tasksBaseDir);
        for (const dir of taskDirs) {
          const match = dir.match(/^[a-f0-9]+-(.+)$/);
          if (match?.[1]) {
            taskDirMap.set(match[1], pathService.join(tasksBaseDir, dir));
          }
        }
      }

      const projectConfigCache = new Map<
        string,
        Record<string, { port: number; path: string; url?: string }>
      >();

      const enrichedTasks: TskTaskResponse[] = [];
      for (const task of tasks) {
        let services = projectConfigCache.get(task.repo_root);
        if (services === undefined) {
          services = yield* loadProjectConfig(task.repo_root);
          projectConfigCache.set(task.repo_root, services);
        }
        const taskDir = taskDirMap.get(task.id) ?? "";
        enrichedTasks.push(enrichTask(task, taskDir, services));
      }

      return enrichedTasks;
    }).pipe(Effect.catchAll(() => Effect.succeed([] as TskTaskResponse[])));

  const getTaskTranscript = (taskId: string) =>
    Effect.gen(function* () {
      const homeDir = yield* getHomeDir();
      const tasksBaseDir = pathService.join(
        homeDir,
        ".local",
        "share",
        "tsk",
        "tasks",
      );

      const tasksDirExists = yield* fs.exists(tasksBaseDir);
      if (!tasksDirExists) return { conversations: [] as unknown[] };

      const taskDirs = yield* fs.readDirectory(tasksBaseDir);
      let transcriptsDir = "";
      for (const dir of taskDirs) {
        if (dir.endsWith(`-${taskId}`)) {
          transcriptsDir = pathService.join(tasksBaseDir, dir, "transcripts");
          break;
        }
      }

      if (!transcriptsDir) {
        return { conversations: [] as unknown[], error: "Task not found" };
      }

      const findJsonl = (
        dir: string,
      ): Effect.Effect<string | null, never, never> =>
        Effect.gen(function* () {
          const dirExists = yield* fs.exists(dir);
          if (!dirExists) return null;

          const entries = yield* fs.readDirectory(dir);

          // First pass: look for .jsonl files at this level
          for (const entry of entries) {
            if (entry.endsWith(".jsonl")) {
              const fullPath = pathService.join(dir, entry);
              const stat = yield* fs.stat(fullPath);
              if (stat.type === "File") {
                return fullPath;
              }
            }
          }

          // Second pass: recurse into subdirectories (skip 'subagents')
          for (const entry of entries) {
            if (entry === "subagents") continue;
            const fullPath = pathService.join(dir, entry);
            const stat = yield* fs.stat(fullPath);
            if (stat.type === "Directory") {
              const found = yield* findJsonl(fullPath);
              if (found) return found;
            }
          }

          return null;
        }).pipe(Effect.catchAll(() => Effect.succeed(null)));

      const jsonlFile = yield* findJsonl(transcriptsDir);
      if (!jsonlFile) {
        return { conversations: [] as unknown[] };
      }

      const content = yield* fs.readFileString(jsonlFile);
      const lines = content.trim().split("\n").filter(Boolean);
      const conversations = lines
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return { type: "x-error", line };
          }
        })
        .filter(
          (conv: { type: string }) =>
            conv.type === "user" ||
            conv.type === "assistant" ||
            conv.type === "system",
        );

      return { conversations };
    }).pipe(
      Effect.catchAll(() => Effect.succeed({ conversations: [] as unknown[] })),
    );

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

  return {
    listTasks,
    getTaskTranscript,
    createTask,
    deleteTask,
    generateServeHostname,
    enrichTask,
  };
});

export type ITskService = InferEffect<typeof LayerImpl>;
export class TskService extends Context.Tag("TskService")<
  TskService,
  ITskService
>() {
  static Live = Layer.effect(this, LayerImpl);
}
