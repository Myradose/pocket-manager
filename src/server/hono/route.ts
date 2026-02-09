import { type CommandExecutor, FileSystem, Path } from "@effect/platform";
import { zValidator } from "@hono/zod-validator";
import { Effect, Runtime } from "effect";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import prexit from "prexit";
import { z } from "zod";
import packageJson from "../../../package.json" with { type: "json" };
import { AgentSessionController } from "../core/agent-session/presentation/AgentSessionController";
import { ClaudeCodeController } from "../core/claude-code/presentation/ClaudeCodeController";
import { ClaudeCodePermissionController } from "../core/claude-code/presentation/ClaudeCodePermissionController";
import { ClaudeCodeSessionProcessController } from "../core/claude-code/presentation/ClaudeCodeSessionProcessController";
import { userMessageInputSchema } from "../core/claude-code/schema";
import { ClaudeCodeLifeCycleService } from "../core/claude-code/services/ClaudeCodeLifeCycleService";
import { TypeSafeSSE } from "../core/events/functions/typeSafeSSE";
import { SSEController } from "../core/events/presentation/SSEController";
import { FeatureFlagController } from "../core/feature-flag/presentation/FeatureFlagController";
import { FileSystemController } from "../core/file-system/presentation/FileSystemController";
import { GitController } from "../core/git/presentation/GitController";
import { CommitRequestSchema, PushRequestSchema } from "../core/git/schema";
import {
  CcvOptionsService,
  type CliOptions,
} from "../core/platform/services/CcvOptionsService";
import { EnvService } from "../core/platform/services/EnvService";
import { UserConfigService } from "../core/platform/services/UserConfigService";
import type { ProjectRepository } from "../core/project/infrastructure/ProjectRepository";
import { ProjectController } from "../core/project/presentation/ProjectController";
import type { SchedulerConfigBaseDir } from "../core/scheduler/config";
import { SchedulerController } from "../core/scheduler/presentation/SchedulerController";
import {
  newSchedulerJobSchema,
  updateSchedulerJobSchema,
} from "../core/scheduler/schema";
import { SearchController } from "../core/search/presentation/SearchController";
import type { VirtualConversationDatabase } from "../core/session/infrastructure/VirtualConversationDatabase";
import { SessionController } from "../core/session/presentation/SessionController";
import type { SessionMetaService } from "../core/session/services/SessionMetaService";
import { userConfigSchema } from "../lib/config/config";
import { effectToResponse } from "../lib/effect/toEffectResponse";
import type { HonoAppType } from "./app";
import { InitializeService } from "./initialize";
import { AuthMiddleware } from "./middleware/auth.middleware";
import { configMiddleware } from "./middleware/config.middleware";

export const routes = (app: HonoAppType, options: CliOptions) =>
  Effect.gen(function* () {
    const ccvOptionsService = yield* CcvOptionsService;
    yield* ccvOptionsService.loadCliOptions(options);

    // services
    // const ccvOptionsService = yield* CcvOptionsService;
    const envService = yield* EnvService;
    const userConfigService = yield* UserConfigService;
    const claudeCodeLifeCycleService = yield* ClaudeCodeLifeCycleService;
    const initializeService = yield* InitializeService;

    // controllers
    const projectController = yield* ProjectController;
    const sessionController = yield* SessionController;
    const agentSessionController = yield* AgentSessionController;
    const gitController = yield* GitController;
    const claudeCodeSessionProcessController =
      yield* ClaudeCodeSessionProcessController;
    const claudeCodePermissionController =
      yield* ClaudeCodePermissionController;
    const sseController = yield* SSEController;
    const fileSystemController = yield* FileSystemController;
    const claudeCodeController = yield* ClaudeCodeController;
    const schedulerController = yield* SchedulerController;
    const featureFlagController = yield* FeatureFlagController;
    const searchController = yield* SearchController;

    // middleware
    const authMiddlewareService = yield* AuthMiddleware;
    const { authMiddleware, validSessionToken, authEnabled, anthPassword } =
      yield* authMiddlewareService;

    const runtime = yield* Effect.runtime<
      | CcvOptionsService
      | EnvService
      | SessionMetaService
      | VirtualConversationDatabase
      | FileSystem.FileSystem
      | Path.Path
      | CommandExecutor.CommandExecutor
      | UserConfigService
      | ClaudeCodeLifeCycleService
      | ProjectRepository
      | SchedulerConfigBaseDir
    >();

    if ((yield* envService.getEnv("NEXT_PHASE")) !== "phase-production-build") {
      yield* initializeService.startInitialization();

      prexit(async () => {
        await Runtime.runPromise(runtime)(initializeService.stopCleanup());
      });
    }

    return (
      app
        // middleware
        .use(configMiddleware)
        .use(authMiddleware)
        .use(async (c, next) => {
          await Effect.runPromise(
            userConfigService.setUserConfig({
              ...c.get("userConfig"),
            }),
          );

          await next();
        })

        // auth routes
        .post(
          "/api/auth/login",
          zValidator("json", z.object({ password: z.string() })),
          async (c) => {
            const { password } = c.req.valid("json");

            // Check if auth is configured
            if (!authEnabled) {
              return c.json(
                {
                  error:
                    "Authentication not configured. Set CLAUDE_CODE_VIEWER_AUTH_PASSWORD environment variable.",
                },
                500,
              );
            }

            if (password !== anthPassword) {
              return c.json({ error: "Invalid password" }, 401);
            }

            setCookie(c, "ccv-session", validSessionToken, {
              httpOnly: true,
              secure: false, // Set to true in production with HTTPS
              sameSite: "Lax",
              path: "/",
              maxAge: 60 * 60 * 24 * 7, // 7 days
            });

            return c.json({ success: true });
          },
        )

        .post("/api/auth/logout", async (c) => {
          deleteCookie(c, "ccv-session", { path: "/" });
          return c.json({ success: true });
        })

        .get("/api/auth/check", async (c) => {
          const sessionToken = getCookie(c, "ccv-session");
          const isAuthenticated = authEnabled
            ? sessionToken === validSessionToken
            : true;
          return c.json({ authenticated: isAuthenticated, authEnabled });
        })

        // routes
        .get("/api/config", async (c) => {
          return c.json({
            config: c.get("userConfig"),
          });
        })

        .put("/api/config", zValidator("json", userConfigSchema), async (c) => {
          const { ...config } = c.req.valid("json");

          setCookie(c, "ccv-config", JSON.stringify(config));

          return c.json({
            config,
          });
        })

        .get("/api/version", async (c) => {
          return c.json({
            version: packageJson.version,
          });
        })

        /**
         * ProjectController Routes
         */

        .get("/api/projects", async (c) => {
          const response = await effectToResponse(
            c,
            projectController.getProjects(),
          );
          return response;
        })

        .get(
          "/api/projects/:projectId",
          zValidator("query", z.object({ cursor: z.string().optional() })),
          async (c) => {
            const response = await effectToResponse(
              c,
              projectController
                .getProject({
                  ...c.req.param(),
                  ...c.req.valid("query"),
                })
                .pipe(Effect.provide(runtime)),
            );
            return response;
          },
        )

        .post(
          "/api/projects",
          zValidator(
            "json",
            z.object({
              projectPath: z.string().min(1, "Project path is required"),
            }),
          ),
          async (c) => {
            const response = await effectToResponse(
              c,
              projectController
                .createProject({
                  ...c.req.valid("json"),
                })
                .pipe(Effect.provide(runtime)),
            );
            return response;
          },
        )

        .get("/api/projects/:projectId/latest-session", async (c) => {
          const response = await effectToResponse(
            c,
            projectController
              .getProjectLatestSession({
                ...c.req.param(),
              })
              .pipe(Effect.provide(runtime)),
          );
          return response;
        })

        /**
         * SessionController Routes
         */

        .get("/api/projects/:projectId/sessions/:sessionId", async (c) => {
          const response = await effectToResponse(
            c,
            sessionController
              .getSession({ ...c.req.param() })
              .pipe(Effect.provide(runtime)),
          );
          return response;
        })

        .get(
          "/api/projects/:projectId/sessions/:sessionId/export",
          async (c) => {
            const response = await effectToResponse(
              c,
              sessionController
                .exportSessionHtml({ ...c.req.param() })
                .pipe(Effect.provide(runtime)),
            );
            return response;
          },
        )

        .get("/api/projects/:projectId/agent-sessions/:agentId", async (c) => {
          const { projectId, agentId } = c.req.param();

          const response = await effectToResponse(
            c,
            agentSessionController
              .getAgentSession({
                projectId,
                agentId,
              })
              .pipe(Effect.provide(runtime)),
          );
          return response;
        })

        /**
         * GitController Routes
         */

        .get("/api/projects/:projectId/git/current-revisions", async (c) => {
          const response = await effectToResponse(
            c,
            gitController
              .getCurrentRevisions({
                ...c.req.param(),
              })
              .pipe(Effect.provide(runtime)),
          );
          return response;
        })

        .post(
          "/api/projects/:projectId/git/diff",
          zValidator(
            "json",
            z.object({
              fromRef: z.string().min(1, "fromRef is required"),
              toRef: z.string().min(1, "toRef is required"),
            }),
          ),
          async (c) => {
            const response = await effectToResponse(
              c,
              gitController
                .getGitDiff({
                  ...c.req.param(),
                  ...c.req.valid("json"),
                })
                .pipe(Effect.provide(runtime)),
            );
            return response;
          },
        )

        .post(
          "/api/projects/:projectId/git/commit",
          zValidator("json", CommitRequestSchema),
          async (c) => {
            const response = await effectToResponse(
              c,
              gitController
                .commitFiles({
                  ...c.req.param(),
                  ...c.req.valid("json"),
                })
                .pipe(Effect.provide(runtime)),
            );
            return response;
          },
        )

        .post(
          "/api/projects/:projectId/git/push",
          zValidator("json", PushRequestSchema),
          async (c) => {
            const response = await effectToResponse(
              c,
              gitController
                .pushCommits({
                  ...c.req.param(),
                  ...c.req.valid("json"),
                })
                .pipe(Effect.provide(runtime)),
            );
            return response;
          },
        )

        .post(
          "/api/projects/:projectId/git/commit-and-push",
          zValidator("json", CommitRequestSchema),
          async (c) => {
            const response = await effectToResponse(
              c,
              gitController
                .commitAndPush({
                  ...c.req.param(),
                  ...c.req.valid("json"),
                })
                .pipe(Effect.provide(runtime)),
            );
            return response;
          },
        )

        /**
         * ClaudeCodeController Routes
         */

        .get("/api/projects/:projectId/claude-commands", async (c) => {
          const response = await effectToResponse(
            c,
            claudeCodeController
              .getClaudeCommands({
                ...c.req.param(),
              })
              .pipe(Effect.provide(runtime)),
          );
          return response;
        })

        .get("/api/projects/:projectId/mcp/list", async (c) => {
          const response = await effectToResponse(
            c,
            claudeCodeController
              .getMcpListRoute({
                ...c.req.param(),
              })
              .pipe(Effect.provide(runtime)),
          );
          return response;
        })

        .get("/api/cc/meta", async (c) => {
          const response = await effectToResponse(
            c,
            claudeCodeController
              .getClaudeCodeMeta()
              .pipe(Effect.provide(runtime)),
          );
          return response;
        })

        .get("/api/cc/features", async (c) => {
          const response = await effectToResponse(
            c,
            claudeCodeController
              .getAvailableFeatures()
              .pipe(Effect.provide(runtime)),
          );
          return response;
        })

        /**
         * ClaudeCodeSessionProcessController Routes
         */

        .get("/api/cc/session-processes", async (c) => {
          const response = await effectToResponse(
            c,
            claudeCodeSessionProcessController.getSessionProcesses(),
          );
          return response;
        })

        // new or resume
        .post(
          "/api/cc/session-processes",
          zValidator(
            "json",
            z.object({
              projectId: z.string(),
              input: userMessageInputSchema,
              baseSessionId: z.string().optional(),
            }),
          ),
          async (c) => {
            const response = await effectToResponse(
              c,
              claudeCodeSessionProcessController.createSessionProcess(
                c.req.valid("json"),
              ),
            );
            return response;
          },
        )

        // continue
        .post(
          "/api/cc/session-processes/:sessionProcessId/continue",
          zValidator(
            "json",
            z.object({
              projectId: z.string(),
              input: userMessageInputSchema,
              baseSessionId: z.string(),
            }),
          ),
          async (c) => {
            const response = await effectToResponse(
              c,
              claudeCodeSessionProcessController
                .continueSessionProcess({
                  ...c.req.param(),
                  ...c.req.valid("json"),
                })
                .pipe(Effect.provide(runtime)),
            );
            return response;
          },
        )

        .post(
          "/api/cc/session-processes/:sessionProcessId/abort",
          zValidator("json", z.object({ projectId: z.string() })),
          async (c) => {
            const { sessionProcessId } = c.req.param();
            void Effect.runFork(
              claudeCodeLifeCycleService.abortTask(sessionProcessId),
            );
            return c.json({ message: "Task aborted" });
          },
        )

        /**
         * ClaudeCodePermissionController Routes
         */

        .post(
          "/api/cc/permission-response",
          zValidator(
            "json",
            z.object({
              permissionRequestId: z.string(),
              decision: z.enum(["allow", "deny"]),
            }),
          ),
          async (c) => {
            const response = await effectToResponse(
              c,
              claudeCodePermissionController.permissionResponse({
                permissionResponse: c.req.valid("json"),
              }),
            );
            return response;
          },
        )

        /**
         * SSEController Routes
         */

        .get("/api/sse", async (c) => {
          return streamSSE(
            c,
            async (rawStream) => {
              await Runtime.runPromise(runtime)(
                sseController
                  .handleSSE(rawStream)
                  .pipe(Effect.provide(TypeSafeSSE.make(rawStream))),
              );
            },
            async (err) => {
              console.error("Streaming error:", err);
            },
          );
        })

        /**
         * SchedulerController Routes
         */

        .get("/api/scheduler/jobs", async (c) => {
          const response = await effectToResponse(
            c,
            schedulerController.getJobs().pipe(Effect.provide(runtime)),
          );
          return response;
        })

        .post(
          "/api/scheduler/jobs",
          zValidator("json", newSchedulerJobSchema),
          async (c) => {
            const response = await effectToResponse(
              c,
              schedulerController
                .addJob({
                  job: c.req.valid("json"),
                })
                .pipe(Effect.provide(runtime)),
            );
            return response;
          },
        )

        .patch(
          "/api/scheduler/jobs/:id",
          zValidator("json", updateSchedulerJobSchema),
          async (c) => {
            const response = await effectToResponse(
              c,
              schedulerController
                .updateJob({
                  id: c.req.param("id"),
                  job: c.req.valid("json"),
                })
                .pipe(Effect.provide(runtime)),
            );
            return response;
          },
        )

        .delete("/api/scheduler/jobs/:id", async (c) => {
          const response = await effectToResponse(
            c,
            schedulerController
              .deleteJob({
                id: c.req.param("id"),
              })
              .pipe(Effect.provide(runtime)),
          );
          return response;
        })

        /**
         * FileSystemController Routes
         */

        .get(
          "/api/fs/file-completion",
          zValidator(
            "query",
            z.object({
              projectId: z.string(),
              basePath: z.string().optional().default("/api/"),
            }),
          ),
          async (c) => {
            const response = await effectToResponse(
              c,
              fileSystemController.getFileCompletionRoute({
                ...c.req.valid("query"),
              }),
            );

            return response;
          },
        )

        .get(
          "/api/fs/directory-browser",
          zValidator(
            "query",
            z.object({
              currentPath: z.string().optional(),
              showHidden: z
                .string()
                .optional()
                .transform((val) => val === "true"),
            }),
          ),
          async (c) => {
            const response = await effectToResponse(
              c,
              fileSystemController.getDirectoryListingRoute({
                ...c.req.valid("query"),
              }),
            );
            return response;
          },
        )

        /**
         * SearchController Routes
         */
        .get(
          "/api/search",
          zValidator(
            "query",
            z.object({
              q: z.string().min(2),
              limit: z
                .string()
                .optional()
                .transform((val) => (val ? parseInt(val, 10) : undefined)),
              projectId: z.string().optional(),
            }),
          ),
          async (c) => {
            const { q, limit, projectId } = c.req.valid("query");
            const response = await effectToResponse(
              c,
              searchController
                .search({ query: q, limit, projectId })
                .pipe(Effect.provide(runtime)),
            );
            return response;
          },
        )

        /**
         * FeatureFlagController Routes
         */
        .get("/api/flags", async (c) => {
          const response = await effectToResponse(
            c,
            featureFlagController.getFlags().pipe(Effect.provide(runtime)),
          );

          return response;
        })

        /**
         * TSK Routes
         */
        .get("/api/tsk/tasks", async (c) => {
          const homeDir =
            process.env["HOME"] ?? process.env["USERPROFILE"] ?? "";
          const tasksFile = `${homeDir}/.local/share/tsk/tasks.json`;
          const tasksBaseDir = `${homeDir}/.local/share/tsk/tasks`;

          try {
            const fs = await import("node:fs/promises");
            const toml = await import("toml");
            const content = await fs.readFile(tasksFile, "utf-8");
            const tasks = JSON.parse(content) as Array<{
              id: string;
              name: string;
              status: string;
              repo_root: string;
              project: string;
              branch_name: string;
              created_at: string;
              started_at: string | null;
            }>;

            // Scan task directories to find the ones matching task IDs
            const taskDirs = await fs.readdir(tasksBaseDir);
            const taskDirMap = new Map<string, string>();
            for (const dir of taskDirs) {
              // Task directories are named {hash}-{taskId}
              const match = dir.match(/^[a-f0-9]+-(.+)$/);
              if (match?.[1]) {
                taskDirMap.set(match[1], `${tasksBaseDir}/${dir}`);
              }
            }

            // Helper to generate serve hostname (matches TSK's generate_serve_hostname)
            const generateServeHostname = (
              taskName: string,
              taskId: string,
            ): string => {
              const sanitizedName = taskName
                .split("")
                .map((c) => (/[a-zA-Z0-9]/.test(c) ? c.toLowerCase() : "-"))
                .join("")
                .replace(/^-+|-+$/g, "");
              const shortId = taskId.slice(0, 8);
              return sanitizedName ? `${sanitizedName}-${shortId}` : shortId;
            };

            // Load project config cache
            const projectConfigCache = new Map<
              string,
              Record<string, { port: number; path: string; url?: string }>
            >();
            const loadProjectConfig = async (repoRoot: string) => {
              if (projectConfigCache.has(repoRoot)) {
                return projectConfigCache.get(repoRoot);
              }
              try {
                const configPath = `${repoRoot}/.tsk/project.toml`;
                const configContent = await fs.readFile(configPath, "utf-8");
                const parsed = toml.parse(configContent) as {
                  services?: Record<
                    string,
                    { port: number; path: string; url?: string }
                  >;
                };
                projectConfigCache.set(repoRoot, parsed.services ?? {});
                return parsed.services;
              } catch {
                projectConfigCache.set(repoRoot, {});
                return {};
              }
            };

            // Add transcripts_dir and URLs to each task
            const enrichedTasks = await Promise.all(
              tasks.map(async (task) => {
                const taskDir = taskDirMap.get(task.id) ?? "";
                const hostname = generateServeHostname(task.name, task.id);
                const services = await loadProjectConfig(task.repo_root);

                // Default Traefik port
                const traefikPort = 8080;

                // Find frontend and VNC services
                let frontendUrl: string | undefined;
                let vncUrl: string | undefined;

                if (services) {
                  // Look for frontend service (typically named "frontend" or "web" with path "/")
                  const frontendService =
                    services["frontend"] ?? services["web"];
                  if (frontendService) {
                    const displayPath =
                      frontendService.url ?? frontendService.path ?? "/";
                    frontendUrl = `http://${hostname}.localhost:${traefikPort}${displayPath}`;
                  }

                  // Look for VNC service
                  const vncService = services["vnc"];
                  if (vncService) {
                    const displayPath =
                      vncService.url ?? vncService.path ?? "/vnc";
                    vncUrl = `http://${hostname}.localhost:${traefikPort}${displayPath}`;
                  }
                }

                return {
                  ...task,
                  transcripts_dir: taskDir ? `${taskDir}/transcripts` : "",
                  frontend_url: frontendUrl,
                  vnc_url: vncUrl,
                };
              }),
            );

            return c.json(enrichedTasks);
          } catch {
            return c.json([]);
          }
        })

        .get("/api/tsk/tasks/:taskId/transcript", async (c) => {
          const { taskId } = c.req.param();
          const homeDir =
            process.env["HOME"] ?? process.env["USERPROFILE"] ?? "";
          const tasksBaseDir = `${homeDir}/.local/share/tsk/tasks`;

          try {
            const fs = await import("node:fs/promises");
            const path = await import("node:path");

            // Scan task directories to find the one matching the task ID
            const taskDirs = await fs.readdir(tasksBaseDir);
            let transcriptsDir = "";
            for (const dir of taskDirs) {
              if (dir.endsWith(`-${taskId}`)) {
                transcriptsDir = `${tasksBaseDir}/${dir}/transcripts`;
                break;
              }
            }

            if (!transcriptsDir) {
              return c.json({ conversations: [], error: "Task not found" });
            }

            // Find main session JSONL file in transcripts directory
            // Prioritize files at current level before recursing into subdirectories
            const findJsonl = async (dir: string): Promise<string | null> => {
              try {
                const entries = await fs.readdir(dir, { withFileTypes: true });

                // First pass: look for .jsonl files at this level (not in subagents/)
                for (const entry of entries) {
                  if (entry.isFile() && entry.name.endsWith(".jsonl")) {
                    return path.join(dir, entry.name);
                  }
                }

                // Second pass: recurse into subdirectories (but skip 'subagents')
                for (const entry of entries) {
                  if (entry.isDirectory() && entry.name !== "subagents") {
                    const found = await findJsonl(path.join(dir, entry.name));
                    if (found) return found;
                  }
                }
              } catch {
                // Directory doesn't exist yet
              }
              return null;
            };

            const jsonlFile = await findJsonl(transcriptsDir);
            if (!jsonlFile) {
              return c.json({ conversations: [] });
            }

            const content = await fs.readFile(jsonlFile, "utf-8");
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

            return c.json({ conversations });
          } catch {
            return c.json({ conversations: [] });
          }
        })
    );
  });

export type RouteType = ReturnType<typeof routes> extends Effect.Effect<
  infer A,
  unknown,
  unknown
>
  ? A
  : never;
