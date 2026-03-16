import { zValidator } from "@hono/zod-validator";
import { Effect } from "effect";
import { setCookie } from "hono/cookie";
import { z } from "zod";
import packageJson from "../../../package.json" with { type: "json" };
import {
  CcvOptionsService,
  type CliOptions,
} from "../core/platform/services/CcvOptionsService";
import { UserConfigService } from "../core/platform/services/UserConfigService";
import { TerminalController } from "../core/terminal/presentation/TerminalController";
import { ensureTerminalSchema } from "../core/terminal/schema";
import { TerminalSessionService } from "../core/terminal/services/TerminalSessionService";
import { handleTerminalWebSocket } from "../core/terminal/ws/TerminalWebSocketHandler";
import { TskController } from "../core/tsk/presentation/TskController";
import {
  createTaskRequestSchema,
  projectServiceConfigSchema,
} from "../core/tsk/schema";
import { TskService } from "../core/tsk/services/TskService";
import { userConfigSchema } from "../lib/config/config";
import { effectToResponse } from "../lib/effect/toEffectResponse";
import { type HonoAppType, upgradeWebSocket } from "./app";
import { configMiddleware } from "./middleware/config.middleware";

export const routes = (app: HonoAppType, options: CliOptions) =>
  Effect.gen(function* () {
    const ccvOptionsService = yield* CcvOptionsService;
    yield* ccvOptionsService.loadCliOptions(options);

    const userConfigService = yield* UserConfigService;
    const tskController = yield* TskController;
    const terminalController = yield* TerminalController;
    const terminalSessionService = yield* TerminalSessionService;
    const tskService = yield* TskService;

    return (
      app
        // middleware
        .use(configMiddleware)
        .use(async (c, next) => {
          await Effect.runPromise(
            userConfigService.setUserConfig({
              ...c.get("userConfig"),
            }),
          );

          await next();
        })

        // Config routes
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
         * TskController Routes
         */
        .get("/api/tsk/tasks", async (c) => {
          const repo = c.req.query("repo");
          const response = await effectToResponse(
            c,
            tskController.listTasks(repo ? { repo } : undefined),
          );
          return response;
        })

        .get("/api/tsk/tasks/:taskId/transcript", async (c) => {
          const response = await effectToResponse(
            c,
            tskController.getTaskTranscript({ ...c.req.param() }),
          );
          return response;
        })

        .post(
          "/api/tsk/tasks",
          zValidator("json", createTaskRequestSchema),
          async (c) => {
            const response = await effectToResponse(
              c,
              tskController.createTask(c.req.valid("json")),
            );
            return response;
          },
        )

        .delete("/api/tsk/tasks/:taskId", async (c) => {
          const response = await effectToResponse(
            c,
            tskController.deleteTask({ ...c.req.param() }),
          );
          return response;
        })

        .post("/api/tsk/tasks/:taskId/stop", async (c) => {
          const response = await effectToResponse(
            c,
            tskController.stopTask({ ...c.req.param() }),
          );
          return response;
        })

        .post("/api/tsk/tasks/:taskId/continue", async (c) => {
          const response = await effectToResponse(
            c,
            tskController.continueTask({ ...c.req.param() }),
          );
          return response;
        })

        .patch(
          "/api/tsk/tasks/:taskId/rename",
          zValidator("json", z.object({ name: z.string().min(1) })),
          async (c) => {
            const { taskId } = c.req.param();
            const { name } = c.req.valid("json");
            const response = await effectToResponse(
              c,
              tskController.renameTask({ taskId, name }),
            );
            return response;
          },
        )

        .post("/api/tsk/tasks/:taskId/suggest-name", async (c) => {
          const response = await effectToResponse(
            c,
            tskController.suggestName({ ...c.req.param() }),
          );
          return response;
        })

        .post(
          "/api/tsk/open",
          zValidator(
            "json",
            z.object({
              path: z.string().min(1),
              target: z.enum(["explorer", "vscode"]),
            }),
          ),
          async (c) => {
            const body = c.req.valid("json");
            const response = await effectToResponse(
              c,
              tskController.openPath(body),
            );
            return response;
          },
        )

        .get(
          "/api/tsk/service-config",
          zValidator("query", z.object({ projectPath: z.string().min(1) })),
          async (c) => {
            const { projectPath } = c.req.valid("query");
            const response = await effectToResponse(
              c,
              tskController.getServiceDisplayConfig({ projectPath }),
            );
            return response;
          },
        )

        .put(
          "/api/tsk/service-config",
          zValidator("json", projectServiceConfigSchema),
          async (c) => {
            const body = c.req.valid("json");
            const response = await effectToResponse(
              c,
              tskController.updateServiceDisplayConfig(body),
            );
            return response;
          },
        )

        /**
         * TerminalController Routes
         */
        .post(
          "/api/tsk/tasks/:taskId/terminals",
          zValidator("json", ensureTerminalSchema),
          async (c) => {
            const { taskId } = c.req.param();
            const response = await effectToResponse(
              c,
              terminalController.ensureTerminal({
                taskId,
                ...c.req.valid("json"),
              }),
            );
            return response;
          },
        )

        .get("/api/tsk/tasks/:taskId/terminals", async (c) => {
          const { taskId } = c.req.param();
          const response = await effectToResponse(
            c,
            terminalController.listTerminals({ taskId }),
          );
          return response;
        })

        .delete("/api/tsk/tasks/:taskId/terminals/:name", async (c) => {
          const { taskId, name } = c.req.param();
          const response = await effectToResponse(
            c,
            terminalController.destroyTerminal({ taskId, name }),
          );
          return response;
        })

        .get(
          "/api/tsk/tasks/:taskId/terminals/:name/ws",
          upgradeWebSocket((c) => {
            const taskId = c.req.param("taskId") ?? "";
            const name = c.req.param("name") ?? "";
            return handleTerminalWebSocket(
              taskId,
              name,
              terminalSessionService,
              tskService,
            );
          }),
        )
    );
  });

export type RouteType = ReturnType<typeof routes> extends Effect.Effect<
  infer A,
  unknown,
  unknown
>
  ? A
  : never;
