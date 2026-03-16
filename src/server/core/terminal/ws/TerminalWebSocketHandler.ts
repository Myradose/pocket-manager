import { Effect } from "effect";
import type { WSContext } from "hono/ws";
import type { TskService } from "../../tsk/services/TskService";
import type { TerminalSessionService } from "../services/TerminalSessionService";

const GRACE_PERIOD_MS = 60_000; // 60 seconds for page refresh

let nextListenerId = 0;

export const handleTerminalWebSocket = (
  taskId: string,
  tmuxSessionName: string,
  terminalSessionService: TerminalSessionService["Type"],
  tskService: TskService["Type"],
) => {
  // Each WebSocket connection gets a unique listener ID
  const listenerId = `ws-${nextListenerId++}`;

  return {
    onOpen: (_event: Event, ws: WSContext) => {
      const setup = Effect.gen(function* () {
        // Resolve containerId from taskId
        const tasks = yield* tskService.listTasks();
        const task = tasks.find((t) => t.id === taskId);
        if (!task?.container_id) {
          ws.close(1008, "Task not found or no container");
          return;
        }
        const containerId = task.container_id;

        // Cancel any pending cleanup
        yield* terminalSessionService.cancelPtyCleanup(
          containerId,
          tmuxSessionName,
        );

        // Get existing or create new PTY attachment
        let attachment = yield* terminalSessionService.getPtyAttachment(
          containerId,
          tmuxSessionName,
        );

        if (!attachment) {
          // Create fresh PTY attachment
          const result = yield* Effect.either(
            terminalSessionService.attachPty(
              containerId,
              taskId,
              tmuxSessionName,
            ),
          );
          if (result._tag === "Left") {
            ws.close(1011, "Failed to attach PTY");
            return;
          }
          attachment = result.right;
        }

        // Register this WebSocket as a data listener
        attachment.dataListeners.set(listenerId, (data: string) => {
          try {
            ws.send(data);
          } catch {
            // WebSocket may be closed
          }
        });

        attachment.pty.onExit(() => {
          try {
            ws.close(1000, "PTY exited");
          } catch {
            // WebSocket may already be closed
          }
        });
      });

      Effect.runPromise(setup).catch(() => {
        try {
          ws.close(1011, "Setup failed");
        } catch {
          // ignore
        }
      });
    },

    onMessage: (event: MessageEvent, _ws: WSContext) => {
      const handleMessage = Effect.gen(function* () {
        const tasks = yield* tskService.listTasks();
        const task = tasks.find((t) => t.id === taskId);
        if (!task?.container_id) return;

        const attachment = yield* terminalSessionService.getPtyAttachment(
          task.container_id,
          tmuxSessionName,
        );
        if (!attachment) return;

        const data =
          typeof event.data === "string" ? event.data : String(event.data);

        // Control message: starts with NUL byte
        if (data.startsWith("\x00")) {
          try {
            const control = JSON.parse(data.slice(1));
            if (
              control.type === "resize" &&
              typeof control.cols === "number" &&
              typeof control.rows === "number"
            ) {
              attachment.pty.resize(control.cols, control.rows);
              // Refresh copy-mode buffer after resize so reflowed
              // content displays correctly (no-op if not in copy mode).
              // Debounce: only fire after resizing stops.
              if (attachment.refreshTimer)
                clearTimeout(attachment.refreshTimer);
              attachment.refreshTimer = setTimeout(async () => {
                attachment.refreshTimer = undefined;
                try {
                  const { execSync } = await import("node:child_process");
                  execSync(
                    `docker exec ${attachment.containerId} tmux if -F '#{pane_in_mode}' 'send-keys -X refresh-from-pane' ''`,
                    { timeout: 3000 },
                  );
                } catch {
                  // ignore — tmux < 3.2 or not in copy mode
                }
              }, 300);
            }
          } catch {
            // Invalid control message, ignore
          }
          return;
        }

        // Regular terminal input
        attachment.pty.write(data);
      });

      Effect.runPromise(handleMessage).catch(() => {
        // ignore message errors
      });
    },

    onClose: () => {
      const cleanup = Effect.gen(function* () {
        const tasks = yield* tskService.listTasks();
        const task = tasks.find((t) => t.id === taskId);
        if (!task?.container_id) return;

        const attachment = yield* terminalSessionService.getPtyAttachment(
          task.container_id,
          tmuxSessionName,
        );
        if (attachment) {
          attachment.dataListeners.delete(listenerId);
          // Only schedule PTY cleanup when no listeners remain
          if (attachment.dataListeners.size === 0) {
            yield* terminalSessionService.markPtyForCleanup(
              task.container_id,
              tmuxSessionName,
              GRACE_PERIOD_MS,
            );
          }
        }
      });

      Effect.runPromise(cleanup).catch(() => {
        // ignore cleanup errors
      });
    },

    onError: () => {
      const cleanup = Effect.gen(function* () {
        const tasks = yield* tskService.listTasks();
        const task = tasks.find((t) => t.id === taskId);
        if (!task?.container_id) return;

        const attachment = yield* terminalSessionService.getPtyAttachment(
          task.container_id,
          tmuxSessionName,
        );
        if (attachment) {
          attachment.dataListeners.delete(listenerId);
          if (attachment.dataListeners.size === 0) {
            yield* terminalSessionService.markPtyForCleanup(
              task.container_id,
              tmuxSessionName,
              GRACE_PERIOD_MS,
            );
          }
        }
      });

      Effect.runPromise(cleanup).catch(() => {
        // ignore cleanup errors
      });
    },
  };
};
