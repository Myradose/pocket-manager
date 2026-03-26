import { Context, Effect, Layer } from "effect";
import type { InferEffect } from "../../../lib/effect/types";

// Bun.spawn terminal types (bun runtime only)
interface BunTerminal {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

declare const Bun: {
  spawn(
    cmd: string[],
    opts: {
      terminal: {
        cols?: number;
        rows?: number;
        name?: string;
        data?: (terminal: BunTerminal, data: Uint8Array) => void;
      };
      env?: NodeJS.ProcessEnv;
    },
  ): {
    pid: number;
    terminal: BunTerminal;
    kill(): void;
    exited: Promise<number>;
  };
};

export type PtyAttachment = {
  containerId: string;
  tmuxSessionName: string;
  taskId: string;
  pty: {
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(): void;
    onExit(cb: () => void): void;
  };
  cleanupTimer?: ReturnType<typeof setTimeout>;
  /** Active WebSocket client — only one at a time to avoid tmux size conflicts */
  activeClient?: {
    id: number;
    send(data: string): void;
    close(): void;
  };
};

// Critical commands use && so failure is detected.
// Non-critical commands use "|| true" so they can't break the chain.
const TMUX_CONFIG_COMMANDS = [
  // --- Critical: mouse + scroll (must succeed) ---
  "tmux set -g mouse on",
  "tmux set -g history-limit 10000",
  'tmux bind -Tcopy-mode WheelUpPane select-pane "\\;" send -N1 -X scroll-up',
  'tmux bind -Tcopy-mode WheelDownPane select-pane "\\;" send -N1 -X scroll-down',
  'tmux bind -Tcopy-mode-vi WheelUpPane select-pane "\\;" send -N1 -X scroll-up',
  'tmux bind -Tcopy-mode-vi WheelDownPane select-pane "\\;" send -N1 -X scroll-down',
  // --- Non-critical: colors, terminal type, unbinds (may fail on older tmux) ---
  '(tmux set -g default-terminal "tmux-256color" || true)',
  '(tmux set -as terminal-features ",xterm*:RGB" || true)',
  '(tmux set -g mode-style "bg=#264f78,fg=#cccccc" || true)',
  "(tmux unbind -n MouseDown3Pane 2>/dev/null || true)",
  "(tmux unbind -n M-MouseDown3Pane 2>/dev/null || true)",
].join(" && ");

const SAFE_NAME = /^[a-zA-Z0-9_-]+$/;

const assertSafeName = (name: string) => {
  if (!SAFE_NAME.test(name)) {
    throw new Error(`Invalid terminal name: ${name}`);
  }
};

const ptyAttachmentKey = (containerId: string, tmuxName: string) =>
  `${containerId}:${tmuxName}`;

const LayerImpl = Effect.gen(function* () {
  const attachments = new Map<string, PtyAttachment>();
  const configuredContainers = new Set<string>();

  const applyTmuxConfig = (containerId: string) =>
    Effect.tryPromise({
      try: async () => {
        const { execSync } = await import("node:child_process");
        execSync(`docker exec ${containerId} sh -c '${TMUX_CONFIG_COMMANDS}'`, {
          timeout: 10000,
        });
        configuredContainers.add(containerId);
      },
      catch: (error) =>
        new Error(
          `Failed to apply tmux config: ${error instanceof Error ? error.message : String(error)}`,
        ),
    });

  const killAttachment = (attachment: PtyAttachment) => {
    if (attachment.cleanupTimer) clearTimeout(attachment.cleanupTimer);
    try {
      attachment.pty.kill();
    } catch {
      // PTY may already be dead
    }
    attachments.delete(
      ptyAttachmentKey(attachment.containerId, attachment.tmuxSessionName),
    );
  };

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
    Effect.gen(function* () {
      const result = yield* Effect.tryPromise({
        try: async () => {
          assertSafeName(name);
          const { execSync } = await import("node:child_process");
          try {
            execSync(`docker exec ${containerId} tmux has-session -t ${name}`, {
              timeout: 5000,
            });
            return { name, created: false };
          } catch {
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

      return result;
    });

  const destroyTmuxSession = (containerId: string, name: string) =>
    Effect.tryPromise({
      try: async () => {
        assertSafeName(name);
        const key = ptyAttachmentKey(containerId, name);
        const existing = attachments.get(key);
        if (existing) killAttachment(existing);
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
    Effect.gen(function* () {
      // Always apply tmux config on attach — this runs each time a WebSocket
      // connects and needs a fresh PTY, so a page refresh will re-apply it.
      if (!configuredContainers.has(containerId)) {
        yield* applyTmuxConfig(containerId).pipe(
          Effect.catchAll(() => Effect.void),
        );
      }

      return yield* Effect.tryPromise({
        try: async () => {
          assertSafeName(name);
          const key = ptyAttachmentKey(containerId, name);
          const existing = attachments.get(key);
          if (existing) killAttachment(existing);

          const exitCallbacks: Array<() => void> = [];

          const proc = Bun.spawn(
            [
              "docker",
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
              terminal: {
                cols: cols ?? 80,
                rows: rows ?? 24,
                name: "xterm-256color",
                data(_terminal, data) {
                  const a = attachments.get(key);
                  if (a?.activeClient) {
                    try {
                      a.activeClient.send(Buffer.from(data).toString());
                    } catch {
                      // client may be closed
                    }
                  }
                },
              },
              // biome-ignore lint/style/noProcessEnv: Bun.spawn requires raw env for Docker exec
              env: process.env,
            },
          );

          const attachment: PtyAttachment = {
            containerId,
            tmuxSessionName: name,
            taskId,
            pty: {
              write: (data: string) => proc.terminal.write(data),
              resize: (c: number, r: number) => proc.terminal.resize(c, r),
              kill: () => proc.kill(),
              onExit: (cb: () => void) => {
                exitCallbacks.push(cb);
              },
            },
          };

          attachments.set(key, attachment);

          proc.exited.then(() => {
            for (const cb of exitCallbacks) {
              try {
                cb();
              } catch {
                // ignore
              }
            }
            attachments.delete(key);
          });

          return attachment;
        },
        catch: (error) =>
          new Error(error instanceof Error ? error.message : String(error)),
      });
    });

  const getPtyAttachment = (containerId: string, name: string) =>
    Effect.sync(
      () => attachments.get(ptyAttachmentKey(containerId, name)) ?? null,
    );

  const detachPty = (containerId: string, name: string) =>
    Effect.sync(() => {
      const key = ptyAttachmentKey(containerId, name);
      const existing = attachments.get(key);
      if (existing) killAttachment(existing);
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
        attachment.cleanupTimer = setTimeout(
          () => killAttachment(attachment),
          delayMs,
        );
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

  const reconfigureTmux = (containerId: string) =>
    Effect.gen(function* () {
      configuredContainers.delete(containerId);
      yield* applyTmuxConfig(containerId);
      return { applied: true };
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
    reconfigureTmux,
  };
});

export type ITerminalSessionService = InferEffect<typeof LayerImpl>;
export class TerminalSessionService extends Context.Tag(
  "TerminalSessionService",
)<TerminalSessionService, ITerminalSessionService>() {
  static Live = Layer.effect(this, LayerImpl);
}
