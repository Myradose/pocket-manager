import { Effect } from "effect";
import type { WSContext } from "hono/ws";
import type { TerminalSessionService } from "../services/TerminalSessionService";

const GRACE_PERIOD_MS = 60_000; // 60 seconds for page refresh

export const handleTerminalWebSocket = (
  sessionId: string,
  terminalSessionService: TerminalSessionService["Type"],
) => ({
  onOpen: (_event: Event, ws: WSContext) => {
    Effect.runSync(terminalSessionService.cancelCleanup(sessionId));

    const session = Effect.runSync(
      terminalSessionService.getSession(sessionId),
    );
    if (!session) {
      ws.close(1008, "Session not found");
      return;
    }

    // Dispose previous onData listener (from prior WS connection) to avoid stacking
    if (session.dataListenerDispose) {
      session.dataListenerDispose();
    }

    // Pipe PTY output to WebSocket
    const disposable = session.pty.onData((data: string) => {
      try {
        ws.send(data);
      } catch {
        // WebSocket may be closed
      }
    });
    session.dataListenerDispose = () => disposable.dispose();

    session.pty.onExit(() => {
      try {
        ws.close(1000, "PTY exited");
      } catch {
        // WebSocket may already be closed
      }
    });
  },

  onMessage: (event: MessageEvent, _ws: WSContext) => {
    const session = Effect.runSync(
      terminalSessionService.getSession(sessionId),
    );
    if (!session) return;

    Effect.runSync(terminalSessionService.updateActivity(sessionId));

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
          session.pty.resize(control.cols, control.rows);
        }
      } catch {
        // Invalid control message, ignore
      }
      return;
    }

    // Regular terminal input
    session.pty.write(data);
  },

  onClose: () => {
    // Mark for cleanup with grace period (handles page refresh)
    Effect.runSync(
      terminalSessionService.markForCleanup(sessionId, GRACE_PERIOD_MS),
    );
  },

  onError: () => {
    void Effect.runPromise(terminalSessionService.destroySession(sessionId));
  },
});
