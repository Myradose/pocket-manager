import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { type FC, useEffect, useRef, useState } from "react";
import "./terminal.css";

type XTerminalProps = {
  taskId: string;
  tmuxSessionName: string;
  visible: boolean;
  autoCommand?: string;
};

const sendResize = (ws: WebSocket, cols: number, rows: number) => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(`\x00${JSON.stringify({ type: "resize", cols, rows })}`);
  }
};

export const XTerminal: FC<XTerminalProps> = ({
  taskId,
  tmuxSessionName,
  visible,
  autoCommand,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const [displaced, setDisplaced] = useState(false);
  const displacedRef = useRef(false);
  const [reconnectKey, setReconnectKey] = useState(0);

  // Phase 1: Create terminal, measure exact dimensions.
  // Runs once on mount.
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    container.classList.remove("terminal-container--visible");

    const terminal = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      cursorStyle: "block",
      fontSize: 13,
      lineHeight: 1.2,
      fontFamily:
        "'Cascadia Code', 'Fira Code', Consolas, 'DejaVu Sans Mono', Menlo, monospace",
      fontWeight: "400",
      fontWeightBold: "bold",
      minimumContrastRatio: 4.5,
      drawBoldTextInBrightColors: true,
      scrollback: 0,
      theme: {
        background: "#181818",
        foreground: "#cccccc",
        cursor: "#aeafad",
        cursorAccent: "#181818",
        selectionBackground: "rgba(38, 79, 120, 0.5)",
        black: "#000000",
        red: "#cd3131",
        green: "#0dbc79",
        yellow: "#e5e510",
        blue: "#2472c8",
        magenta: "#bc3fbc",
        cyan: "#11a8cd",
        white: "#e5e5e5",
        brightBlack: "#666666",
        brightRed: "#f14c4c",
        brightGreen: "#23d18b",
        brightYellow: "#f5f543",
        brightBlue: "#3b8eea",
        brightMagenta: "#d670d6",
        brightCyan: "#29b8db",
        brightWhite: "#e5e5e5",
      },
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const unicode11Addon = new Unicode11Addon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.loadAddon(unicode11Addon);
    terminal.unicode.activeVersion = "11";
    terminal.open(container);

    fitAddonRef.current = fitAddon;
    terminalRef.current = terminal;

    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
      });
      terminal.loadAddon(webglAddon);
    } catch {
      // WebGL not available, fall back to DOM renderer
    }

    // Auto-copy to clipboard on selection (Shift+drag to select).
    terminal.onSelectionChange(() => {
      const selection = terminal.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection).catch(() => {
          // Clipboard access denied
        });
      }
    });

    // Forward terminal input to the WebSocket (if connected and not displaced).
    terminal.onData((data) => {
      if (displacedRef.current) return;
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // Keep the terminal fitted and forward resize to the backend.
    // Only send resize when visible to avoid tmux size conflicts with other terminals.
    const resizeObserver = new ResizeObserver(() => {
      if (!visibleRef.current || displacedRef.current) return;
      try {
        fitAddon.fit();
        const ws = wsRef.current;
        if (ws) sendResize(ws, terminal.cols, terminal.rows);
      } catch {
        // Ignore resize errors during cleanup
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      container.classList.remove("terminal-container--visible");
      terminal.dispose();
      fitAddonRef.current = null;
      terminalRef.current = null;
    };
  }, []);

  // Phase 2: Ensure tmux session and connect WebSocket with reconnection.
  // reconnectKey is included in deps so "Take Control" can force a fresh connection.
  useEffect(() => {
    void reconnectKey;
    if (!terminalRef.current || !containerRef.current) return;
    const terminal = terminalRef.current;
    const container = containerRef.current;
    let cancelled = false;
    let reconnectAttempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let isNewSession = false;

    const connect = async () => {
      if (cancelled) return;

      // Wait for fonts to be ready and fit before measuring
      await document.fonts.ready;
      if (cancelled) return;
      try {
        fitAddonRef.current?.fit();
      } catch {
        // ignore fit errors
      }

      // Ensure tmux session exists
      try {
        const ensureResponse = await fetch(
          `/api/tsk/tasks/${taskId}/terminals`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: tmuxSessionName,
              cols: terminal.cols,
              rows: terminal.rows,
            }),
          },
        );
        if (ensureResponse.ok) {
          const data = (await ensureResponse.json()) as { created: boolean };
          if (data.created) {
            isNewSession = true;
          }
        } else {
          if (cancelled) return;
          scheduleReconnect();
          return;
        }
      } catch {
        if (cancelled) return;
        scheduleReconnect();
        return;
      }

      // Connect WebSocket
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/api/tsk/tasks/${taskId}/terminals/${tmuxSessionName}/ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        reconnectAttempt = 0;

        document.fonts.ready.then(() => {
          if (cancelled) return;
          try {
            fitAddonRef.current?.fit();
          } catch {
            // ignore fit errors
          }
          // Don't reveal yet — wait for first onmessage so the cursor
          // is positioned correctly before the terminal is visible.
          if (visibleRef.current) {
            // Tmux skips redraw when dimensions are unchanged, so
            // briefly shrink by 1 column to force a full repaint.
            sendResize(ws, Math.max(1, terminal.cols - 1), terminal.rows);
            setTimeout(() => {
              if (cancelled || ws.readyState !== WebSocket.OPEN) return;
              sendResize(ws, terminal.cols, terminal.rows);
            }, 50);
          }
        });
      };

      let autoCommandSent = false;
      ws.onmessage = (event) => {
        const raw =
          typeof event.data === "string" ? event.data : String(event.data);

        // Server control message (NUL-prefixed JSON)
        if (raw.startsWith("\x00")) {
          try {
            const control = JSON.parse(raw.slice(1));
            if (control.type === "displaced") {
              displacedRef.current = true;
              setDisplaced(true);
            }
          } catch {
            // ignore malformed control messages
          }
          return;
        }

        terminal.write(raw);

        // Reveal on first data
        container.classList.add("terminal-container--visible");

        // Send autoCommand only for newly created sessions, not on reconnect
        if (autoCommand && isNewSession && !autoCommandSent) {
          autoCommandSent = true;
          setTimeout(() => {
            if (!cancelled && ws.readyState === WebSocket.OPEN) {
              ws.send(`${autoCommand}\n`);
            }
          }, 300);
        }
      };

      ws.onclose = () => {
        if (!cancelled && !displacedRef.current) {
          wsRef.current = null;
          scheduleReconnect();
        }
      };

      ws.onerror = () => {
        // onclose will fire after onerror
      };
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      // Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
      const delay = Math.min(1000 * 2 ** reconnectAttempt, 30_000);
      reconnectAttempt++;
      reconnectTimer = setTimeout(connect, delay);
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
    };
  }, [taskId, tmuxSessionName, autoCommand, reconnectKey]);

  // Re-fit and sync dimensions when becoming visible (e.g. switching tabs).
  useEffect(() => {
    if (visible && fitAddonRef.current && terminalRef.current) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          fitAddonRef.current?.fit();
          const ws = wsRef.current;
          const terminal = terminalRef.current;
          if (ws && terminal) {
            sendResize(ws, terminal.cols, terminal.rows);
          }
        });
      });
    }
  }, [visible]);

  const handleTakeControl = () => {
    displacedRef.current = false;
    setDisplaced(false);
    setReconnectKey((k) => k + 1);
  };

  return (
    <>
      <div ref={containerRef} className="terminal-container" />
      <div className="terminal-loading">
        <span className="terminal-loading-cursor">▋</span>
      </div>
      {displaced && (
        <div className="terminal-displaced">
          <div className="terminal-displaced__content">
            <p>This terminal is active in another tab.</p>
            <button
              type="button"
              className="terminal-displaced__button"
              onClick={handleTakeControl}
            >
              Take Control
            </button>
          </div>
        </div>
      )}
    </>
  );
};
