import { Effect } from "effect";
import type { WSContext } from "hono/ws";
import type { TskService } from "../../tsk/services/TskService";
import type { TerminalSessionService } from "../services/TerminalSessionService";

const GRACE_PERIOD_MS = 60_000; // 60 seconds for page refresh

export const handleTerminalWebSocket = (
  taskId: string,
  tmuxSessionName: string,
  terminalSessionService: TerminalSessionService["Type"],
  tskService: TskService["Type"],
) => ({
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

      if (attachment) {
        // Dispose old data listener to avoid stacking
        if (attachment.dataListenerDispose) {
          attachment.dataListenerDispose();
          attachment.dataListenerDispose = undefined;
        }
      } else {
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

      // Wire PTY data → WS
      const disposable = attachment.pty.onData((data: string) => {
        try {
          ws.send(data);
        } catch {
          // WebSocket may be closed
        }
      });
      attachment.dataListenerDispose = () => disposable.dispose();

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

      yield* terminalSessionService.markPtyForCleanup(
        task.container_id,
        tmuxSessionName,
        GRACE_PERIOD_MS,
      );
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

      yield* terminalSessionService.markPtyForCleanup(
        task.container_id,
        tmuxSessionName,
        GRACE_PERIOD_MS,
      );
    });

    Effect.runPromise(cleanup).catch(() => {
      // ignore cleanup errors
    });
  },
});
