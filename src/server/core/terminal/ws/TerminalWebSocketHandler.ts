import { Effect } from "effect";
import type { WSContext } from "hono/ws";
import type { TskService } from "../../tsk/services/TskService";
import type { TerminalSessionService } from "../services/TerminalSessionService";

const GRACE_PERIOD_MS = 60_000; // 60 seconds for page refresh

let nextClientId = 0;

export const handleTerminalWebSocket = (
  taskId: string,
  tmuxSessionName: string,
  terminalSessionService: TerminalSessionService["Type"],
  tskService: TskService["Type"],
) => {
  const clientId = nextClientId++;

  const resolveAttachment = Effect.gen(function* () {
    const tasks = yield* tskService.listTasks();
    const task = tasks.find((t) => t.id === taskId);
    if (!task?.container_id) return null;
    return yield* terminalSessionService.getPtyAttachment(
      task.container_id,
      tmuxSessionName,
    );
  });

  return {
    onOpen: (_event: Event, ws: WSContext) => {
      const setup = Effect.gen(function* () {
        const tasks = yield* tskService.listTasks();
        const task = tasks.find((t) => t.id === taskId);
        if (!task?.container_id) {
          ws.close(1008, "Task not found or no container");
          return;
        }
        const containerId = task.container_id;

        yield* terminalSessionService.cancelPtyCleanup(
          containerId,
          tmuxSessionName,
        );

        let attachment = yield* terminalSessionService.getPtyAttachment(
          containerId,
          tmuxSessionName,
        );

        if (!attachment) {
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

        // Notify old client it's been displaced, then replace it.
        // We don't close the old WebSocket — that would trigger
        // the frontend's auto-reconnect loop.
        if (attachment.activeClient) {
          try {
            attachment.activeClient.send('\x00{"type":"displaced"}');
          } catch {
            // ignore
          }
        }

        attachment.activeClient = {
          id: clientId,
          send: (data: string) => ws.send(data),
          close: () => ws.close(1000, "Replaced by new client"),
        };

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
        const attachment = yield* resolveAttachment;
        if (!attachment) return;

        // Only the active client can send input
        if (attachment.activeClient?.id !== clientId) return;

        const data =
          typeof event.data === "string" ? event.data : String(event.data);

        if (data.startsWith("\x00")) {
          try {
            const control = JSON.parse(data.slice(1));
            if (
              control.type === "resize" &&
              typeof control.cols === "number" &&
              typeof control.rows === "number"
            ) {
              attachment.pty.resize(control.cols, control.rows);
            }
          } catch {
            // Invalid control message, ignore
          }
          return;
        }

        attachment.pty.write(data);
      });

      Effect.runPromise(handleMessage).catch(() => {
        // ignore message errors
      });
    },

    onClose: () => {
      const cleanup = Effect.gen(function* () {
        const attachment = yield* resolveAttachment;
        if (!attachment) return;

        // Only clean up if we're still the active client —
        // a newer client may have already replaced us.
        if (attachment.activeClient?.id !== clientId) return;

        attachment.activeClient = undefined;
        yield* terminalSessionService.markPtyForCleanup(
          attachment.containerId,
          attachment.tmuxSessionName,
          GRACE_PERIOD_MS,
        );
      });

      Effect.runPromise(cleanup).catch(() => {
        // ignore cleanup errors
      });
    },

    onError: () => {
      const cleanup = Effect.gen(function* () {
        const attachment = yield* resolveAttachment;
        if (!attachment) return;

        if (attachment.activeClient?.id !== clientId) return;

        attachment.activeClient = undefined;
        yield* terminalSessionService.markPtyForCleanup(
          attachment.containerId,
          attachment.tmuxSessionName,
          GRACE_PERIOD_MS,
        );
      });

      Effect.runPromise(cleanup).catch(() => {
        // ignore cleanup errors
      });
    },
  };
};
