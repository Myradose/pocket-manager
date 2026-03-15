import { Context, Effect, Layer } from "effect";
import type { InferEffect } from "../../../lib/effect/types";

export type PtyAttachment = {
  containerId: string;
  tmuxSessionName: string;
  taskId: string;
  // biome-ignore lint/suspicious/noExplicitAny: node-pty IPty type is complex native type
  pty: any;
  cleanupTimer?: ReturnType<typeof setTimeout>;
  dataListenerDispose?: () => void;
};

const ptyAttachmentKey = (containerId: string, tmuxName: string) =>
  `${containerId}:${tmuxName}`;

const spawnPtyModule = async () => {
  const { createRequire } = await import("node:module");
  const ptyRequire = createRequire(import.meta.url);
  return ptyRequire("node-pty");
};

const LayerImpl = Effect.gen(function* () {
  const attachments = new Map<string, PtyAttachment>();

  const listTmuxSessions = (containerId: string) =>
    Effect.tryPromise({
      try: async () => {
        const { execSync } = await import("node:child_process");
        const output = execSync(
          `docker exec ${containerId} tmux list-sessions -F "#{session_name}"`,
          { encoding: "utf-8", timeout: 5000 },
        ).trim();
        if (!output) return [];
        return output.split("\n").filter(Boolean);
      },
      catch: () => [] as string[],
    }).pipe(Effect.catchAll(() => Effect.succeed([] as string[])));

  const ensureTmuxSession = (
    containerId: string,
    name: string,
    cols?: number,
    rows?: number,
  ) =>
    Effect.tryPromise({
      try: async () => {
        const { execSync } = await import("node:child_process");
        try {
          execSync(`docker exec ${containerId} tmux has-session -t ${name}`, {
            timeout: 5000,
          });
          return { name, created: false };
        } catch {
          // Session doesn't exist, create it
          const width = cols ?? 80;
          const height = rows ?? 24;
          execSync(
            `docker exec ${containerId} tmux new-session -d -s ${name} -x ${width} -y ${height}`,
            { timeout: 5000 },
          );
          return { name, created: true };
        }
      },
      catch: (error) =>
        new Error(error instanceof Error ? error.message : String(error)),
    });

  const destroyTmuxSession = (containerId: string, name: string) =>
    Effect.tryPromise({
      try: async () => {
        const key = ptyAttachmentKey(containerId, name);
        const existing = attachments.get(key);
        if (existing) {
          if (existing.cleanupTimer) clearTimeout(existing.cleanupTimer);
          if (existing.dataListenerDispose) existing.dataListenerDispose();
          try {
            existing.pty.kill();
          } catch {
            // PTY may already be dead
          }
          attachments.delete(key);
        }
        const { execSync } = await import("node:child_process");
        execSync(`docker exec ${containerId} tmux kill-session -t ${name}`, {
          timeout: 5000,
        });
      },
      catch: () => new Error(`Failed to destroy tmux session ${name}`),
    });

  const attachPty = (
    containerId: string,
    taskId: string,
    name: string,
    cols?: number,
    rows?: number,
  ) =>
    Effect.tryPromise({
      try: async () => {
        const key = ptyAttachmentKey(containerId, name);

        // Kill existing PTY attachment for this session
        const existing = attachments.get(key);
        if (existing) {
          if (existing.cleanupTimer) clearTimeout(existing.cleanupTimer);
          if (existing.dataListenerDispose) existing.dataListenerDispose();
          try {
            existing.pty.kill();
          } catch {
            // PTY may already be dead
          }
          attachments.delete(key);
        }

        const pty = await spawnPtyModule();
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
            "tmux",
            "attach",
            "-t",
            name,
          ],
          {
            name: "xterm-256color",
            cols: cols ?? 80,
            rows: rows ?? 24,
            // biome-ignore lint/style/noProcessEnv: node-pty requires raw env for Docker exec
            env: process.env,
          },
        );

        const attachment: PtyAttachment = {
          containerId,
          tmuxSessionName: name,
          taskId,
          pty: ptyProcess,
        };

        attachments.set(key, attachment);

        // Auto-cleanup when PTY exits
        ptyProcess.onExit(() => {
          attachments.delete(key);
        });

        return attachment;
      },
      catch: (error) =>
        new Error(error instanceof Error ? error.message : String(error)),
    });

  const getPtyAttachment = (containerId: string, name: string) =>
    Effect.sync(
      () => attachments.get(ptyAttachmentKey(containerId, name)) ?? null,
    );

  const detachPty = (containerId: string, name: string) =>
    Effect.sync(() => {
      const key = ptyAttachmentKey(containerId, name);
      const attachment = attachments.get(key);
      if (attachment) {
        if (attachment.cleanupTimer) clearTimeout(attachment.cleanupTimer);
        if (attachment.dataListenerDispose) attachment.dataListenerDispose();
        try {
          attachment.pty.kill();
        } catch {
          // PTY may already be dead
        }
        attachments.delete(key);
      }
    });

  const markPtyForCleanup = (
    containerId: string,
    name: string,
    delayMs: number,
  ) =>
    Effect.sync(() => {
      const key = ptyAttachmentKey(containerId, name);
      const attachment = attachments.get(key);
      if (attachment) {
        if (attachment.cleanupTimer) clearTimeout(attachment.cleanupTimer);
        attachment.cleanupTimer = setTimeout(() => {
          if (attachment.dataListenerDispose) attachment.dataListenerDispose();
          try {
            attachment.pty.kill();
          } catch {
            // PTY may already be dead
          }
          attachments.delete(key);
        }, delayMs);
      }
    });

  const cancelPtyCleanup = (containerId: string, name: string) =>
    Effect.sync(() => {
      const key = ptyAttachmentKey(containerId, name);
      const attachment = attachments.get(key);
      if (attachment?.cleanupTimer) {
        clearTimeout(attachment.cleanupTimer);
        attachment.cleanupTimer = undefined;
      }
    });

  return {
    listTmuxSessions,
    ensureTmuxSession,
    destroyTmuxSession,
    attachPty,
    getPtyAttachment,
    detachPty,
    markPtyForCleanup,
    cancelPtyCleanup,
  };
});

export type ITerminalSessionService = InferEffect<typeof LayerImpl>;
export class TerminalSessionService extends Context.Tag(
  "TerminalSessionService",
)<TerminalSessionService, ITerminalSessionService>() {
  static Live = Layer.effect(this, LayerImpl);
}
