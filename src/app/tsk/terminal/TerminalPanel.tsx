import { Plus, RotateCw, SquareTerminal, X } from "lucide-react";
import { type FC, useCallback, useEffect, useRef, useState } from "react";
import { honoClient } from "../../../lib/api/client";
import { XTerminal } from "./XTerminal";
import "./terminal.css";

type Tab = {
  id: string;
  sessionId: string | null;
  name: string;
  closable: boolean;
  /** Command to auto-run when a new session is created for this tab. */
  autoCommand?: string;
};

type TerminalPanelProps = {
  taskId: string;
  visible: boolean;
};

export const TerminalPanel: FC<TerminalPanelProps> = ({ taskId, visible }) => {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const initRef = useRef(false);
  // Track which tabs have a pending session creation to avoid duplicates.
  const creatingSessions = useRef(new Set<string>());
  const nextTabNumber = useRef(1);

  // On mount, recover existing sessions from the backend
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    const recover = async () => {
      try {
        const response = await honoClient.api.terminals.$get();
        if (response.ok) {
          const sessions = (await response.json()) as Array<{
            id: string;
            taskId: string;
            containerId: string;
            label?: string;
            createdAt: string;
          }>;
          const existing = sessions.filter((s) => s.taskId === taskId);
          if (existing.length > 0) {
            let shellNum = 0;
            const recoveredTabs = existing.map((s) => {
              const isClaude = s.label === "Claude Code";
              if (!isClaude) shellNum++;
              return {
                id: s.id,
                sessionId: s.id,
                name: isClaude ? "Claude Code" : `Shell ${shellNum}`,
                closable: !isClaude,
                autoCommand: isClaude ? "claude" : undefined,
              };
            });
            // Sort so the Claude Code tab is always first
            recoveredTabs.sort((a) => (a.closable ? 1 : -1));
            nextTabNumber.current = shellNum + 1;
            setTabs(recoveredTabs);
            const first = recoveredTabs[0];
            if (first) setActiveTabId(first.id);
          }
        }
      } catch {
        // Failed to recover, will create a fresh tab below
      }
      setInitialized(true);
    };
    recover();
  }, [taskId]);

  // Add a tab immediately (synchronous) — XTerminal mounts, measures exact
  // dimensions via onMeasured, which then triggers session creation.
  const createTab = useCallback(() => {
    const tabId = crypto.randomUUID();
    const tabNumber = nextTabNumber.current++;
    setTabs((prev) => [
      ...prev,
      {
        id: tabId,
        sessionId: null,
        name: `Shell ${tabNumber}`,
        closable: true,
      },
    ]);
    setActiveTabId(tabId);
  }, []);

  // Called by XTerminal after it measures exact cols/rows via FitAddon.
  // Creates the PTY session at those dimensions so tmux starts at the right size.
  const handleMeasured = useCallback(
    async (tabId: string, cols: number, rows: number, label?: string) => {
      if (creatingSessions.current.has(tabId)) return;
      creatingSessions.current.add(tabId);
      try {
        const response = await honoClient.api.terminals.$post({
          json: { taskId, cols, rows, label },
        });
        if (!response.ok) {
          creatingSessions.current.delete(tabId);
          return;
        }
        const data = (await response.json()) as { id: string };
        setTabs((prev) =>
          prev.map((t) => (t.id === tabId ? { ...t, sessionId: data.id } : t)),
        );
      } catch {
        creatingSessions.current.delete(tabId);
      }
    },
    [taskId],
  );

  const closeTab = useCallback(
    async (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (tab && !tab.closable) return;
      if (tab?.sessionId) {
        try {
          await honoClient.api.terminals[":sessionId"].$delete({
            param: { sessionId: tab.sessionId },
          });
        } catch {
          // Ignore cleanup errors
        }
      }
      setTabs((prev) => {
        const remaining = prev.filter((t) => t.id !== tabId);
        if (activeTabId === tabId) {
          const last = remaining[remaining.length - 1];
          setActiveTabId(last ? last.id : null);
        }
        return remaining;
      });
    },
    [tabs, activeTabId],
  );

  // Kill the session and reset the tab so it remounts with a fresh PTY.
  const restartTab = useCallback(
    async (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (tab?.sessionId) {
        try {
          await honoClient.api.terminals[":sessionId"].$delete({
            param: { sessionId: tab.sessionId },
          });
        } catch {
          // Ignore cleanup errors
        }
      }
      const newId = crypto.randomUUID();
      if (activeTabId === tabId) {
        setActiveTabId(newId);
      }
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tabId ? { ...t, id: newId, sessionId: null } : t,
        ),
      );
    },
    [tabs, activeTabId],
  );

  // When a session dies (PTY exited / container not ready):
  // - Non-closable tabs: reset sessionId so they re-measure and re-create
  // - Closable tabs: remove them
  const handleSessionDead = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        const tab = prev.find((t) => t.id === tabId);
        if (tab && !tab.closable) {
          // Reset the non-closable tab — give it a new id so XTerminal remounts
          const newId = crypto.randomUUID();
          if (activeTabId === tabId) {
            setActiveTabId(newId);
          }
          return prev.map((t) =>
            t.id === tabId ? { ...t, id: newId, sessionId: null } : t,
          );
        }
        const remaining = prev.filter((t) => t.id !== tabId);
        if (activeTabId === tabId) {
          const last = remaining[remaining.length - 1];
          setActiveTabId(last ? last.id : null);
        }
        return remaining;
      });
    },
    [activeTabId],
  );

  // Create the dedicated Claude Code tab.
  const createClaudeTab = useCallback(() => {
    const tabId = crypto.randomUUID();
    setTabs((prev) => [
      {
        id: tabId,
        sessionId: null,
        name: "Claude Code",
        closable: false,
        autoCommand: "claude",
      },
      ...prev,
    ]);
    setActiveTabId(tabId);
  }, []);

  // Auto-create Claude Code tab after initialization if none exists
  useEffect(() => {
    if (initialized && !tabs.some((t) => !t.closable)) {
      createClaudeTab();
    }
  }, [initialized, tabs, createClaudeTab]);

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="terminal-tab-bar">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`terminal-tab ${activeTabId === tab.id ? "terminal-tab--active" : ""}`}
            onClick={() => setActiveTabId(tab.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setActiveTabId(tab.id);
            }}
            role="tab"
            tabIndex={0}
            aria-selected={activeTabId === tab.id}
          >
            <SquareTerminal className="w-3.5 h-3.5 shrink-0 opacity-60" />
            <span>{tab.name}</span>
            {tab.closable ? (
              <button
                type="button"
                className="terminal-tab__close"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                aria-label={`Close ${tab.name}`}
              >
                <X className="w-3 h-3" />
              </button>
            ) : (
              <button
                type="button"
                className="terminal-tab__close"
                onClick={(e) => {
                  e.stopPropagation();
                  restartTab(tab.id);
                }}
                aria-label={`Restart ${tab.name}`}
              >
                <RotateCw className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          className="terminal-tab-new"
          onClick={createTab}
          title="New terminal"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Terminal area */}
      <div className="flex-1 relative" style={{ background: "#181818" }}>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className="absolute inset-0"
            style={{ display: activeTabId === tab.id ? "block" : "none" }}
          >
            <XTerminal
              sessionId={tab.sessionId}
              visible={visible && activeTabId === tab.id}
              onMeasured={
                tab.sessionId === null
                  ? (cols, rows) => handleMeasured(tab.id, cols, rows, tab.name)
                  : undefined
              }
              onSessionDead={() => handleSessionDead(tab.id)}
              autoCommand={tab.autoCommand}
            />
          </div>
        ))}
        {tabs.length === 0 && (
          <div
            className="flex items-center justify-center h-full"
            style={{ color: "rgba(255,255,255,0.35)" }}
          >
            <p className="text-sm">No terminal sessions</p>
          </div>
        )}
      </div>
    </div>
  );
};
