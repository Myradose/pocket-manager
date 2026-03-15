import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { type FC, useEffect, useRef } from "react";
import "./terminal.css";

type XTerminalProps = {
  sessionId: string | null;
  visible: boolean;
  onMeasured?: (cols: number, rows: number) => void;
  onSessionDead?: () => void;
};

export const XTerminal: FC<XTerminalProps> = ({
  sessionId,
  visible,
  onMeasured,
  onSessionDead,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const onSessionDeadRef = useRef(onSessionDead);
  const onMeasuredRef = useRef(onMeasured);
  onSessionDeadRef.current = onSessionDead;
  onMeasuredRef.current = onMeasured;

  // Phase 1: Create terminal, measure exact dimensions.
  // Runs once on mount — independent of sessionId.
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    let cancelled = false;

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
      fontWeightBold: "600",
      theme: {
        background: "#0f1119",
        foreground: "#d4d4d8",
        cursor: "#a1a1aa",
        cursorAccent: "#0f1119",
        selectionBackground: "rgba(99, 102, 241, 0.3)",
        selectionForeground: "#e4e4e7",
        black: "#3f3f46",
        red: "#f87171",
        green: "#86efac",
        yellow: "#fde68a",
        blue: "#93c5fd",
        magenta: "#d8b4fe",
        cyan: "#67e8f9",
        white: "#d4d4d8",
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

    // Wait for fonts, remeasure, fit, then report exact dimensions so the
    // parent can create the PTY session at the right size.
    document.fonts.ready.then(() => {
      if (cancelled) return;
      const size = terminal.options.fontSize ?? 13;
      terminal.options.fontSize = size + 0.001;
      terminal.options.fontSize = size;
      try {
        fitAddon.fit();
      } catch {
        // ignore fit errors during setup
      }
      onMeasuredRef.current?.(terminal.cols, terminal.rows);
    });

    // Forward terminal input to the WebSocket (if connected).
    terminal.onData((data) => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // Keep the terminal fitted and forward resize to the backend.
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(
            `\x00${JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows })}`,
          );
        }
      } catch {
        // Ignore resize errors during cleanup
      }
    });
    resizeObserver.observe(container);

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      container.classList.remove("terminal-container--visible");
      terminal.dispose();
      fitAddonRef.current = null;
      terminalRef.current = null;
    };
  }, []);

  // Phase 2: Connect WebSocket once a sessionId is available.
  useEffect(() => {
    if (!sessionId || !terminalRef.current || !containerRef.current) return;
    const terminal = terminalRef.current;
    const container = containerRef.current;
    let cancelled = false;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/terminals/${sessionId}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (cancelled) return;
      // Send exact dimensions so the PTY matches the terminal.
      ws.send(
        `\x00${JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows })}`,
      );
      // Bounce resize after a delay to force tmux to redraw on reconnect.
      setTimeout(() => {
        if (cancelled || ws.readyState !== WebSocket.OPEN) return;
        ws.send(
          `\x00${JSON.stringify({ type: "resize", cols: Math.max(1, terminal.cols - 1), rows: terminal.rows })}`,
        );
        setTimeout(() => {
          if (cancelled || ws.readyState !== WebSocket.OPEN) return;
          ws.send(
            `\x00${JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows })}`,
          );
        }, 100);
      }, 500);
    };

    let revealScheduled = false;
    ws.onmessage = (event) => {
      terminal.write(
        typeof event.data === "string" ? event.data : String(event.data),
      );
      // Reveal on first data — terminal is already fitted at exact dimensions.
      if (!revealScheduled) {
        revealScheduled = true;
        document.fonts.ready.then(() => {
          if (cancelled) return;
          try {
            fitAddonRef.current?.fit();
          } catch {
            // ignore fit errors during setup
          }
          container.classList.add("terminal-container--visible");
        });
      }
    };

    ws.onclose = () => {
      if (!cancelled) {
        onSessionDeadRef.current?.();
      }
    };

    return () => {
      cancelled = true;
      wsRef.current = null;
      container.classList.remove("terminal-container--visible");
      ws.close();
    };
  }, [sessionId]);

  // Re-fit when becoming visible (e.g. switching tabs).
  useEffect(() => {
    if (visible && fitAddonRef.current) {
      requestAnimationFrame(() => {
        fitAddonRef.current?.fit();
      });
    }
  }, [visible]);

  return <div ref={containerRef} className="terminal-container" />;
};
