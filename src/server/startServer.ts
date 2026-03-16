import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NodeContext } from "@effect/platform-node";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Effect } from "effect";
import type { CliOptions } from "./core/platform/services/CcvOptionsService";
import { TerminalController } from "./core/terminal/presentation/TerminalController";
import { TerminalCleanupService } from "./core/terminal/services/TerminalCleanupService";
import { TerminalSessionService } from "./core/terminal/services/TerminalSessionService";
import { TskController } from "./core/tsk/presentation/TskController";
import { ServiceDisplayConfigService } from "./core/tsk/services/ServiceDisplayConfigService";
import { TskService } from "./core/tsk/services/TskService";
import { honoApp, injectWebSocket } from "./hono/app";
import { routes } from "./hono/route";
import { platformLayer } from "./lib/effect/layers";

export const startServer = async (options: CliOptions) => {
  // biome-ignore lint/style/noProcessEnv: allow only here
  const isDevelopment = process.env.NODE_ENV === "development";

  if (!isDevelopment) {
    const staticPath = resolve(import.meta.dirname, "static");
    console.log("Serving static files from ", staticPath);

    honoApp.use(
      "/assets/*",
      serveStatic({
        root: staticPath,
      }),
    );

    honoApp.use("*", async (c, next) => {
      if (c.req.path.startsWith("/api")) {
        return next();
      }

      const html = await readFile(resolve(staticPath, "index.html"), "utf-8");
      return c.html(html);
    });
  }

  const program = routes(honoApp, options)
    .pipe(
      /** Presentation */
      Effect.provide(TskController.Live),
      Effect.provide(TerminalController.Live),
    )
    .pipe(
      /** Domain */
      Effect.provide(TskService.Live),
      Effect.provide(ServiceDisplayConfigService.Live),
      Effect.provide(TerminalCleanupService.Live),
      Effect.provide(TerminalSessionService.Live),
    )
    .pipe(
      /** Platform */
      Effect.provide(platformLayer),
      Effect.provide(NodeContext.layer),
    );

  await Effect.runPromise(program);

  const port = isDevelopment
    ? // biome-ignore lint/style/noProcessEnv: allow only here
      (process.env.DEV_BE_PORT ?? "3401")
    : // biome-ignore lint/style/noProcessEnv: allow only here
      (options.port ?? process.env.PORT ?? "3000");

  // biome-ignore lint/style/noProcessEnv: allow only here
  const hostname = options.hostname ?? process.env.HOSTNAME ?? "localhost";

  const server = serve(
    {
      fetch: honoApp.fetch,
      port: parseInt(port, 10),
      hostname,
    },
    (info) => {
      console.log(`Server is running on http://${hostname}:${info.port}`);
    },
  );

  injectWebSocket(server);
};
