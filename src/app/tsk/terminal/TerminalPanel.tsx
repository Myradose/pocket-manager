import { Plus, SquareTerminal, X } from "lucide-react";
import { type FC, useCallback, useEffect, useRef, useState } from "react";
import { honoClient } from "../../../lib/api/client";
import { XTerminal } from "./XTerminal";
import "./terminal.css";

type Tab = {
  id: string;
  sessionId: string;
  name: string;
};

type TerminalPanelProps = {
  taskId: string;
  visible: boolean;
};

export const TerminalPanel: FC<TerminalPanelProps> = ({ taskId, visible }) => {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const initRef = useRef(false);

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
            createdAt: string;
          }>;
          const existing = sessions.filter((s) => s.taskId === taskId);
          if (existing.length > 0) {
            const recoveredTabs = existing.map((s, i) => ({
              id: s.id,
              sessionId: s.id,
              name: `Shell ${i + 1}`,
            }));
            setTabs(recoveredTabs);
            const last = recoveredTabs[recoveredTabs.length - 1];
            if (last) setActiveTabId(last.id);
          }
        }
      } catch {
        // Failed to recover, will create a fresh tab below
      }
      setInitialized(true);
    };
    recover();
  }, [taskId]);

  const createTab = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const response = await honoClient.api.terminals.$post({
        json: { taskId },
      });
      if (!response.ok) return;
      const data = (await response.json()) as { id: string };
      setTabs((prev) => {
        const tabNumber = prev.length + 1;
        const newTab: Tab = {
          id: data.id,
          sessionId: data.id,
          name: `Shell ${tabNumber}`,
        };
        setActiveTabId(newTab.id);
        return [...prev, newTab];
      });
    } finally {
      setCreating(false);
    }
  }, [taskId, creating]);

  const closeTab = useCallback(
    async (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (tab) {
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

  // When a session dies (PTY exited / container not ready), remove the tab
  // and auto-create a replacement if it was the only one
  const handleSessionDead = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
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

  // Auto-create first tab after initialization if no sessions were recovered
  useEffect(() => {
    if (initialized && tabs.length === 0 && !creating) {
      createTab();
    }
  }, [initialized, tabs.length, creating, createTab]);

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
          </div>
        ))}
        <button
          type="button"
          className="terminal-tab-new"
          onClick={createTab}
          disabled={creating}
          title="New terminal"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Terminal area */}
      <div className="flex-1 relative">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className="absolute inset-0"
            style={{ display: activeTabId === tab.id ? "block" : "none" }}
          >
            <XTerminal
              sessionId={tab.sessionId}
              visible={visible && activeTabId === tab.id}
              onSessionDead={() => handleSessionDead(tab.id)}
            />
          </div>
        ))}
        {tabs.length === 0 && (
          <div
            className="flex items-center justify-center h-full"
            style={{ color: "rgba(255,255,255,0.35)" }}
          >
            <p className="text-sm">
              {creating ? "Connecting..." : "No terminal sessions"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
