import { Context, Effect, Layer } from "effect";
import { ulid } from "ulid";
import type { InferEffect } from "../../../lib/effect/types";

export type TerminalSession = {
  id: string;
  taskId: string;
  containerId: string;
  label?: string;
  createdAt: Date;
  lastActivity: Date;
  // biome-ignore lint/suspicious/noExplicitAny: node-pty IPty type is complex native type
  pty: any;
  cleanupTimer?: ReturnType<typeof setTimeout>;
  // Disposable for the current onData listener (cleaned up on WS reconnect)
  dataListenerDispose?: () => void;
};

const LayerImpl = Effect.gen(function* () {
  const sessions = new Map<string, TerminalSession>();

  const createSession = (
    taskId: string,
    containerId: string,
    cols?: number,
    rows?: number,
    label?: string,
  ) =>
    Effect.tryPromise({
      try: async () => {
        // node-pty is externalized by esbuild (--packages=external)
        // Use createRequire since the bundle runs as ESM
        const { createRequire } = await import("node:module");
        const ptyRequire = createRequire(import.meta.url);
        const pty = ptyRequire("node-pty");
        const sessionId = ulid();
        const now = new Date();

        const tmuxSessionName = `term-${sessionId.slice(0, 8).toLowerCase()}`;
        const ptyProcess = pty.spawn(
          "docker",
          [
            "exec",
            "-it",
            "-e",
            "LANG=C.UTF-8",
            "-e",
            "TERM=xterm-256color",
            "-e",
            "COLORTERM=truecolor",
            "-e",
            "TERM_PROGRAM=viewer",
            containerId,
            "bash",
            "-c",
            `tmux -u new-session -A -s ${tmuxSessionName}`,
          ],
          {
            name: "xterm-256color",
            cols: cols ?? 80,
            rows: rows ?? 24,
            // biome-ignore lint/style/noProcessEnv: node-pty requires raw env for Docker exec
            env: process.env,
          },
        );

        const session: TerminalSession = {
          id: sessionId,
          taskId,
          containerId,
          label,
          createdAt: now,
          lastActivity: now,
          pty: ptyProcess,
        };

        sessions.set(sessionId, session);

        // Auto-cleanup when PTY exits (e.g. container not ready, docker exec fails)
        ptyProcess.onExit(() => {
          sessions.delete(sessionId);
        });

        return { sessionId };
      },
      catch: (error) =>
        new Error(error instanceof Error ? error.message : String(error)),
    });

  const getSession = (sessionId: string) =>
    Effect.sync(() => sessions.get(sessionId) ?? null);

  const destroySession = (sessionId: string) =>
    Effect.sync(() => {
      const session = sessions.get(sessionId);
      if (session) {
        if (session.cleanupTimer) {
          clearTimeout(session.cleanupTimer);
        }
        try {
          session.pty.kill();
        } catch {
          // PTY may already be dead
        }
        sessions.delete(sessionId);
      }
    });

  const listSessions = () =>
    Effect.sync(() =>
      [...sessions.values()].map((s) => ({
        id: s.id,
        taskId: s.taskId,
        containerId: s.containerId,
        label: s.label,
        createdAt: s.createdAt.toISOString(),
      })),
    );

  const markForCleanup = (sessionId: string, delayMs: number) =>
    Effect.sync(() => {
      const session = sessions.get(sessionId);
      if (session) {
        if (session.cleanupTimer) {
          clearTimeout(session.cleanupTimer);
        }
        session.cleanupTimer = setTimeout(() => {
          try {
            session.pty.kill();
          } catch {
            // PTY may already be dead
          }
          sessions.delete(sessionId);
        }, delayMs);
      }
    });

  const cancelCleanup = (sessionId: string) =>
    Effect.sync(() => {
      const session = sessions.get(sessionId);
      if (session?.cleanupTimer) {
        clearTimeout(session.cleanupTimer);
        session.cleanupTimer = undefined;
      }
    });

  const updateActivity = (sessionId: string) =>
    Effect.sync(() => {
      const session = sessions.get(sessionId);
      if (session) {
        session.lastActivity = new Date();
      }
    });

  const cleanupIdleSessions = (maxIdleMs: number) =>
    Effect.sync(() => {
      const now = Date.now();
      for (const [id, session] of sessions) {
        if (now - session.lastActivity.getTime() > maxIdleMs) {
          try {
            session.pty.kill();
          } catch {
            // PTY may already be dead
          }
          sessions.delete(id);
        }
      }
    });

  return {
    createSession,
    getSession,
    destroySession,
    listSessions,
    markForCleanup,
    cancelCleanup,
    updateActivity,
    cleanupIdleSessions,
  };
});

export type ITerminalSessionService = InferEffect<typeof LayerImpl>;
export class TerminalSessionService extends Context.Tag(
  "TerminalSessionService",
)<TerminalSessionService, ITerminalSessionService>() {
  static Live = Layer.effect(this, LayerImpl);
}
