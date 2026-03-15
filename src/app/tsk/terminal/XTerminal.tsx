import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { type FC, useEffect, useRef } from "react";
import "./terminal.css";

type XTerminalProps = {
  sessionId: string;
  visible: boolean;
  onSessionDead?: () => void;
};

export const XTerminal: FC<XTerminalProps> = ({
  sessionId,
  visible,
  onSessionDead,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const onSessionDeadRef = useRef(onSessionDead);
  onSessionDeadRef.current = onSessionDead;

  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;
    let ws: WebSocket | null = null;

    const terminal = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      cursorStyle: "block",
      fontSize: 13,
      lineHeight: 1.2,
      fontFamily:
        "'Cascadia Code', 'Fira Code', Consolas, 'DejaVu Sans Mono', Menlo, monospace",
      fontWeight: "400",
      fontWeightBold: "600",
      theme: {
        background: "#0f1119",
        foreground: "#d4d4d8",
        cursor: "#a1a1aa",
        cursorAccent: "#0f1119",
        selectionBackground: "rgba(99, 102, 241, 0.3)",
        selectionForeground: "#e4e4e7",
        // Normal colors
        black: "#3f3f46",
        red: "#f87171",
        green: "#86efac",
        yellow: "#fde68a",
        blue: "#93c5fd",
        magenta: "#d8b4fe",
        cyan: "#67e8f9",
        white: "#d4d4d8",
        // Bright colors
        brightBlack: "#52525b",
        brightRed: "#fca5a5",
        brightGreen: "#a7f3d0",
        brightYellow: "#fef08a",
        brightBlue: "#bfdbfe",
        brightMagenta: "#e9d5ff",
        brightCyan: "#a5f3fc",
        brightWhite: "#fafafa",
      },
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const unicode11Addon = new Unicode11Addon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.loadAddon(unicode11Addon);
    terminal.unicode.activeVersion = "11";
    terminal.open(containerRef.current);

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

    requestAnimationFrame(() => {
      fitAddon.fit();
    });

    // Connect WebSocket to existing session
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/terminals/${sessionId}/ws`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      if (!cancelled) {
        fitAddon.fit();
        const cols = terminal.cols;
        const rows = terminal.rows;
        // Bounce resize after a delay to let tmux start (fresh sessions)
        // or to force tmux to redraw (reconnected sessions).
        // First resize to cols-1, then to real size triggers SIGWINCH → full redraw.
        setTimeout(() => {
          if (cancelled || ws?.readyState !== WebSocket.OPEN) return;
          ws.send(
            `\x00${JSON.stringify({ type: "resize", cols: Math.max(1, cols - 1), rows })}`,
          );
          setTimeout(() => {
            if (cancelled || ws?.readyState !== WebSocket.OPEN) return;
            ws.send(`\x00${JSON.stringify({ type: "resize", cols, rows })}`);
          }, 100);
        }, 500);
      }
    };

    ws.onmessage = (event) => {
      terminal.write(
        typeof event.data === "string" ? event.data : String(event.data),
      );
    };

    ws.onclose = () => {
      // If the server closed the connection (not client cleanup), the session is dead
      if (!cancelled) {
        onSessionDeadRef.current?.();
      }
    };

    terminal.onData((data) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        if (ws?.readyState === WebSocket.OPEN) {
          const dims = {
            type: "resize",
            cols: terminal.cols,
            rows: terminal.rows,
          };
          ws.send(`\x00${JSON.stringify(dims)}`);
        }
      } catch {
        // Ignore resize errors during cleanup
      }
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      if (ws) {
        ws.close();
      }
      terminal.dispose();
      fitAddonRef.current = null;
      terminalRef.current = null;
    };
  }, [sessionId]);

  // Re-fit when becoming visible
  useEffect(() => {
    if (visible && fitAddonRef.current) {
      requestAnimationFrame(() => {
        fitAddonRef.current?.fit();
      });
    }
  }, [visible]);

  return <div ref={containerRef} className="terminal-container" />;
};
