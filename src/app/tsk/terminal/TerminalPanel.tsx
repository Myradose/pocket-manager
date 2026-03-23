import { Plus, RotateCw, SquareTerminal, X } from "lucide-react";
import { type FC, useCallback, useEffect, useRef, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { XTerminal } from "./XTerminal";
import "./terminal.css";

type Tab = {
  name: string;
  displayName: string;
  closable: boolean;
  autoCommand?: string;
  generation: number;
};

type TerminalPanelProps = {
  taskId: string;
  visible: boolean;
};

const buildTerminalUrl = (taskId: string, path: string) =>
  `/api/tsk/tasks/${taskId}/terminals${path}`;

export const TerminalPanel: FC<TerminalPanelProps> = ({ taskId, visible }) => {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabName, setActiveTabName] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const initRef = useRef(false);
  const nextShellNumber = useRef(1);

  // On mount, recover existing tmux sessions from the container
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    const recover = async () => {
      try {
        const response = await fetch(buildTerminalUrl(taskId, ""));
        if (response.ok) {
          const sessions = (await response.json()) as Array<{
            name: string;
            attached: boolean;
          }>;
          if (sessions.length > 0) {
            let maxShellNum = 0;
            const recoveredTabs: Tab[] = sessions.map((s) => {
              const isClaude = s.name === "claude";
              const shellMatch = /^shell-(\d+)$/.exec(s.name);
              const shellNum = shellMatch?.[1]
                ? parseInt(shellMatch[1], 10)
                : 0;
              if (shellNum > maxShellNum) maxShellNum = shellNum;
              return {
                name: s.name,
                displayName: isClaude
                  ? "Claude Code"
                  : shellMatch
                    ? `Shell ${shellNum}`
                    : s.name,
                closable: !isClaude,
                generation: 0,
              };
            });
            // Sort so the Claude Code tab is always first
            recoveredTabs.sort((a) => (a.closable ? 1 : -1));
            nextShellNumber.current = maxShellNum + 1;
            setTabs(recoveredTabs);
            const first = recoveredTabs[0];
            if (first) setActiveTabName(first.name);
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
    const shellNum = nextShellNumber.current++;
    const name = `shell-${shellNum}`;
    const tab: Tab = {
      name,
      displayName: `Shell ${shellNum}`,
      closable: true,
      generation: 0,
    };
    setTabs((prev) => [...prev, tab]);
    setActiveTabName(name);

    try {
      await fetch(buildTerminalUrl(taskId, ""), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
    } catch {
      // POST will also happen from XTerminal on connect, so this is best-effort
    }
  }, [taskId]);

  const closeTab = useCallback(
    async (tabName: string) => {
      const tab = tabs.find((t) => t.name === tabName);
      if (tab && !tab.closable) return;

      try {
        await fetch(buildTerminalUrl(taskId, `/${tabName}`), {
          method: "DELETE",
        });
      } catch {
        // Ignore cleanup errors
      }

      setTabs((prev) => {
        const remaining = prev.filter((t) => t.name !== tabName);
        if (activeTabName === tabName) {
          const last = remaining[remaining.length - 1];
          setActiveTabName(last ? last.name : null);
        }
        return remaining;
      });
    },
    [tabs, activeTabName, taskId],
  );

  const restartTab = useCallback(
    async (tabName: string) => {
      // DELETE the tmux session, then increment generation to force XTerminal remount.
      // The new XTerminal will POST ensure (creating a fresh tmux session) and reconnect.
      try {
        await fetch(buildTerminalUrl(taskId, `/${tabName}`), {
          method: "DELETE",
        });
      } catch {
        // Ignore cleanup errors
      }

      // Increment generation — React key changes, old XTerminal unmounts (cancelling
      // reconnect), new XTerminal mounts and creates a fresh session atomically.
      setTabs((prev) =>
        prev.map((t) =>
          t.name === tabName ? { ...t, generation: t.generation + 1 } : t,
        ),
      );
    },
    [taskId],
  );

  // Create the dedicated Claude Code tab
  const createClaudeTab = useCallback(() => {
    const tab: Tab = {
      name: "claude",
      displayName: "Claude Code",
      closable: false,
      generation: 0,
    };
    setTabs((prev) => [tab, ...prev]);
    setActiveTabName("claude");
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
            key={tab.name}
            className={`terminal-tab ${activeTabName === tab.name ? "terminal-tab--active" : ""}`}
            onClick={() => setActiveTabName(tab.name)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setActiveTabName(tab.name);
            }}
            role="tab"
            tabIndex={0}
            aria-selected={activeTabName === tab.name}
          >
            <SquareTerminal className="size-3.5 shrink-0 opacity-60" />
            <span>{tab.displayName}</span>
            {tab.closable ? (
              <button
                type="button"
                className="terminal-tab__close"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.name);
                }}
                aria-label={`Close ${tab.displayName}`}
              >
                <X className="size-3" />
              </button>
            ) : (
              <button
                type="button"
                className="terminal-tab__close"
                onClick={(e) => {
                  e.stopPropagation();
                  restartTab(tab.name);
                }}
                aria-label={`Restart ${tab.displayName}`}
              >
                <RotateCw className="size-3" />
              </button>
            )}
          </div>
        ))}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="terminal-tab-new"
              onClick={createTab}
            >
              <Plus className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>New terminal</TooltipContent>
        </Tooltip>
      </div>

      {/* Terminal area */}
      <div className="flex-1 relative" style={{ background: "#181818" }}>
        {tabs.map((tab) => (
          <div
            key={`${tab.name}-${tab.generation}`}
            className="absolute inset-0"
            style={{ display: activeTabName === tab.name ? "block" : "none" }}
          >
            <XTerminal
              taskId={taskId}
              tmuxSessionName={tab.name}
              visible={visible && activeTabName === tab.name}
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
