import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowDown,
  Check,
  CheckCheck,
  Code,
  Columns2,
  Copy,
  FolderOpen,
  Info,
  Loader2,
  Maximize2,
  MessageSquare,
  Play,
  Square,
  SquareTerminal,
  Trash2,
} from "lucide-react";
import {
  type CSSProperties,
  type FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConversationList } from "../projects/[projectId]/sessions/[sessionId]/components/conversationList/ConversationList";
import { EditableTaskName } from "./EditableTaskName";
import type { ServiceDisplayConfig, TskTask } from "./queries";
import {
  tskTranscriptQuery,
  useContinueTskTask,
  useDeleteTskTask,
  useOpenPath,
  useStopTskTask,
} from "./queries";
import { defaultServiceLabel, ServiceIcon } from "./ServiceIcon";
import { TerminalPanel } from "./terminal/TerminalPanel";

export type GridViewMode = "conversation" | "terminal" | `service:${string}`;
type DetailViewMode = GridViewMode | "split";

type TskPaneProps = {
  task: TskTask;
  isGridView?: boolean;
  // Controlled view mode (used for both grid and detail view)
  viewMode?: GridViewMode;
  onViewModeChange?: (mode: GridViewMode) => void;
  // Whether to show tool calls overlay on VNC
  showToolsOverlay?: boolean;
  // Selection state for focus mode
  isSelected?: boolean;
  onToggleSelect?: () => void;
  showSelectionControls?: boolean;
  // Scroll state lifted to parent for persistence across navigation
  savedScrollPosition?: number;
  onScrollPositionChange?: (position: number) => void;
  initialAutoScroll?: boolean;
  onAutoScrollChange?: (autoScroll: boolean) => void;
  // Service display config from settings
  displayConfig?: Record<string, ServiceDisplayConfig>;
  // Panel mounting controlled by parent (grid view LRU)
  mountedPanels?: Set<GridViewMode>;
  onPanelMount?: (mode: GridViewMode) => void;
};

// Extract recent tool calls from conversations
const getRecentToolCalls = (
  conversations: Array<{ type: string; message?: { content?: unknown } }>,
  limit = 3,
) => {
  const toolCalls: Array<{ name: string; args: string }> = [];

  for (
    let i = conversations.length - 1;
    i >= 0 && toolCalls.length < limit;
    i--
  ) {
    const conv = conversations[i];
    if (!conv) continue;
    if (conv.type === "assistant" && conv.message?.content) {
      const content = conv.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "tool_use" && toolCalls.length < limit) {
            const name = block.name || "unknown";
            // Summarize args - pick the most relevant field
            let args = "";
            if (block.input) {
              const input = block.input as Record<string, unknown>;
              if (input.command) args = String(input.command);
              else if (input.file_path) args = String(input.file_path);
              else if (input.pattern) args = String(input.pattern);
              else if (input.url) args = String(input.url);
              else if (input.prompt) args = String(input.prompt);
              else if (input.description) args = String(input.description);
              else {
                // For other tools, show first key=value pair
                const keys = Object.keys(input);
                const key = keys[0];
                if (key !== undefined) {
                  const rawVal = input[key];
                  const val =
                    typeof rawVal === "string"
                      ? rawVal
                      : JSON.stringify(rawVal);
                  args = `${key}=${val}`;
                }
              }
            }
            toolCalls.unshift({ name, args });
          }
        }
      }
    }
  }

  return toolCalls;
};

// Format relative time (e.g., "2 min ago")
const formatRelativeTime = (dateString: string | null): string => {
  if (!dateString) return "Not started";
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);

  if (diffSec < 60) return "Just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffHr < 24) return `${diffHr} hr ago`;
  return date.toLocaleDateString();
};

function getPanelPositionStyle(
  panelMode: GridViewMode,
  viewMode: DetailViewMode,
  splitLeft: GridViewMode,
  splitRight: GridViewMode,
): CSSProperties {
  if (viewMode === "split") {
    const isLeft = panelMode === splitLeft;
    const isRight = panelMode === splitRight;
    if (isLeft && isRight) return { position: "absolute", inset: 0 };
    if (isLeft)
      return {
        position: "absolute",
        top: 0,
        bottom: 0,
        left: 0,
        width: "50%",
      };
    if (isRight)
      return {
        position: "absolute",
        top: 0,
        bottom: 0,
        left: "50%",
        width: "50%",
      };
    return { display: "none" };
  }
  return panelMode === viewMode
    ? { position: "absolute", inset: 0 }
    : { display: "none" };
}

export const TskPane: FC<TskPaneProps> = ({
  task,
  isGridView = false,
  viewMode: controlledViewMode = "terminal",
  onViewModeChange,
  showToolsOverlay = true,
  isSelected = false,
  onToggleSelect,
  showSelectionControls = false,
  savedScrollPosition,
  onScrollPositionChange,
  initialAutoScroll,
  onAutoScrollChange,
  displayConfig = {},
  mountedPanels: externalMountedPanels,
  onPanelMount,
}) => {
  // Services sorted by display config order
  const sortedServices = useMemo(
    () =>
      [...task.services].sort((a, b) => {
        const orderA = displayConfig[a.key]?.order ?? 0;
        const orderB = displayConfig[b.key]?.order ?? 0;
        return orderA - orderB;
      }),
    [task.services, displayConfig],
  );

  // Mode options for split pane selectors
  const splitModeOptions = useMemo(() => {
    const opts: { mode: GridViewMode; iconName: string; label: string }[] = [
      { mode: "terminal", iconName: "Terminal", label: "Terminal" },
      {
        mode: "conversation",
        iconName: "MessageSquare",
        label: "Conversation",
      },
    ];
    for (const svc of sortedServices) {
      const cfg = displayConfig[svc.key];
      if (cfg && !cfg.visible) continue;
      opts.push({
        mode: `service:${svc.key}`,
        iconName: cfg?.icon ?? "ExternalLink",
        label: cfg?.label ?? defaultServiceLabel(svc.key),
      });
    }
    return opts;
  }, [sortedServices, displayConfig]);

  const deleteTask = useDeleteTskTask();
  const stopTask = useStopTskTask();
  const continueTask = useContinueTskTask();
  const openPath = useOpenPath();
  const navigate = useNavigate();
  const [showStopDialog, setShowStopDialog] = useState(false);

  const isActiveTask = task.status === "RUNNING" || task.status === "SERVING";
  const [userInitiatedStop, setUserInitiatedStop] = useState(false);
  const isTransitioning =
    userInitiatedStop ||
    task.status === "STOPPING" ||
    task.status === "DELETING";

  // Navigate away when stop completes (task reaches terminal state after user-initiated stop)
  useEffect(() => {
    if (
      userInitiatedStop &&
      !isGridView &&
      (task.status === "STOPPED" || task.status === "FAILED")
    ) {
      navigate({ to: "/tsk", search: {} });
    }
  }, [task.status, userInitiatedStop, isGridView, navigate]);

  const handleStopConfirm = useCallback(() => {
    setShowStopDialog(false);
    if (isActiveTask) {
      setUserInitiatedStop(true);
      stopTask.mutate(task.id);
    } else {
      deleteTask.mutate(task.id);
      if (!isGridView) {
        navigate({ to: "/tsk", search: {} });
      }
    }
  }, [task.id, isActiveTask, isGridView, stopTask, deleteTask, navigate]);

  // Track if split mode is active (detail view only feature)
  const [isSplitMode, setIsSplitMode] = useState(false);
  const splitStorageKey = `tsk-split:${task.repo_root}`;
  const [splitLeft, _setSplitLeft] = useState<GridViewMode>("terminal");
  const [splitRight, _setSplitRight] = useState<GridViewMode>("conversation");

  // Wrap setters to persist split pair to localStorage
  const setSplitLeft = useCallback(
    (mode: GridViewMode) => {
      _setSplitLeft(mode);
      try {
        const saved = JSON.parse(localStorage.getItem(splitStorageKey) ?? "{}");
        localStorage.setItem(
          splitStorageKey,
          JSON.stringify({ ...saved, left: mode }),
        );
      } catch {}
    },
    [splitStorageKey],
  );
  const setSplitRight = useCallback(
    (mode: GridViewMode) => {
      _setSplitRight(mode);
      try {
        const saved = JSON.parse(localStorage.getItem(splitStorageKey) ?? "{}");
        localStorage.setItem(
          splitStorageKey,
          JSON.stringify({ ...saved, right: mode }),
        );
      } catch {}
    },
    [splitStorageKey],
  );
  // Lazy panel mounting: parent-controlled (grid view with global LRU) or self-managed (detail view)
  const [internalMountedPanels, setInternalMountedPanels] = useState<
    Set<GridViewMode>
  >(() => new Set([controlledViewMode]));

  const mountedPanels = externalMountedPanels ?? internalMountedPanels;

  useEffect(() => {
    if (externalMountedPanels) {
      // Parent-controlled: notify parent when a new panel should mount
      if (!externalMountedPanels.has(controlledViewMode)) {
        onPanelMount?.(controlledViewMode);
      }
    } else {
      // Self-managed (detail view): mount immediately
      setInternalMountedPanels((prev) => {
        if (prev.has(controlledViewMode)) return prev;
        return new Set(prev).add(controlledViewMode);
      });
    }
  }, [controlledViewMode, externalMountedPanels, onPanelMount]);

  const [showInfo, setShowInfo] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Use parent-provided autoScroll state if available, otherwise default to true
  const [autoScroll, setAutoScrollLocal] = useState(initialAutoScroll ?? true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const prevViewMode = useRef<string | null>(null);

  // Sync autoScroll changes to parent
  const setAutoScroll = useCallback(
    (value: boolean) => {
      setAutoScrollLocal(value);
      onAutoScrollChange?.(value);
    },
    [onAutoScrollChange],
  );

  // Reset split mode when switching to grid view
  useEffect(() => {
    if (isGridView) {
      setIsSplitMode(false);
    }
  }, [isGridView]);

  // Stopped tasks have no container — force to conversation if on a container-dependent mode
  const isStopped = task.status === "STOPPED";
  useEffect(() => {
    if (isStopped) {
      setIsSplitMode(false);
      if (
        controlledViewMode === "terminal" ||
        controlledViewMode.startsWith("service:")
      ) {
        onViewModeChange?.("conversation");
      }
    }
  }, [isStopped, controlledViewMode, onViewModeChange]);

  // Effective view mode: use split if active (detail only), otherwise use controlled mode
  const effectiveViewMode: DetailViewMode =
    !isGridView && isSplitMode ? "split" : controlledViewMode;

  // Mount split panels when entering split mode
  useEffect(() => {
    if (effectiveViewMode === "split") {
      if (externalMountedPanels) {
        if (!externalMountedPanels.has(splitLeft)) onPanelMount?.(splitLeft);
        if (!externalMountedPanels.has(splitRight)) onPanelMount?.(splitRight);
      } else {
        setInternalMountedPanels((prev) => {
          const next = new Set(prev);
          let changed = false;
          if (!next.has(splitLeft)) {
            next.add(splitLeft);
            changed = true;
          }
          if (!next.has(splitRight)) {
            next.add(splitRight);
            changed = true;
          }
          return changed ? next : prev;
        });
      }
    }
  }, [
    effectiveViewMode,
    splitLeft,
    splitRight,
    externalMountedPanels,
    onPanelMount,
  ]);

  // Restore scroll position when returning to conversation view
  useEffect(() => {
    const wasConversation = prevViewMode.current === "conversation";
    const isConversation = effectiveViewMode === "conversation";

    // Entering conversation view - restore position after render
    if (
      !wasConversation &&
      isConversation &&
      savedScrollPosition !== undefined
    ) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (scrollRef.current) {
            scrollRef.current.scrollTop = savedScrollPosition;
          }
        });
      });
    }

    prevViewMode.current = effectiveViewMode;
  }, [effectiveViewMode, savedScrollPosition]);

  const handleViewModeChange = (mode: GridViewMode) => {
    setIsSplitMode(false); // Exit split mode when selecting a regular mode
    onViewModeChange?.(mode);
  };

  const handleSplitMode = () => {
    if (!isSplitMode) {
      // Try restoring last-used split pair from localStorage
      let restored = false;
      try {
        const saved = JSON.parse(localStorage.getItem(splitStorageKey) ?? "{}");
        if (saved.left && saved.right) {
          _setSplitLeft(saved.left);
          _setSplitRight(saved.right);
          restored = true;
        }
      } catch {}

      if (!restored) {
        const visibleServices = sortedServices.filter((s) => {
          const cfg = displayConfig[s.key];
          return !cfg || cfg.visible;
        });
        if (
          visibleServices.length >= 2 &&
          visibleServices[0] &&
          visibleServices[1]
        ) {
          setSplitLeft(`service:${visibleServices[0].key}`);
          setSplitRight(`service:${visibleServices[1].key}`);
        } else if (visibleServices.length === 1 && visibleServices[0]) {
          setSplitLeft("terminal");
          setSplitRight(`service:${visibleServices[0].key}`);
        } else {
          setSplitLeft("terminal");
          setSplitRight("conversation");
        }
      }
    }
    setIsSplitMode(true);
  };

  const handleCopy = async (text: string, field: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const { data: transcriptData } = useQuery(tskTranscriptQuery(task.id));

  const conversations = useMemo(() => {
    return transcriptData?.conversations ?? [];
  }, [transcriptData]);

  const recentToolCalls = useMemo(() => {
    return getRecentToolCalls(conversations);
  }, [conversations]);

  // Auto-scroll to bottom when conversations change (only if already at bottom)
  useEffect(() => {
    if (!autoScroll || !scrollRef.current || conversations.length === 0) return;
    if (effectiveViewMode !== "conversation") return;

    // Use double rAF to ensure DOM is fully rendered and measured
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      });
    });
  }, [conversations, autoScroll, effectiveViewMode]);

  // Throttled scroll handler to avoid excessive re-renders
  const lastScrollUpdate = useRef(0);
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;

    const now = Date.now();
    // Throttle to ~60fps (16ms) for isAtBottom check, less frequent for position save
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 50;

    // Always update isAtBottom for responsive button
    if (atBottom !== isAtBottom) {
      setIsAtBottom(atBottom);
    }

    // Throttle autoScroll and position updates to every 100ms
    if (now - lastScrollUpdate.current > 100) {
      lastScrollUpdate.current = now;
      setAutoScroll(atBottom);
      onScrollPositionChange?.(scrollTop);
    }
  }, [isAtBottom, onScrollPositionChange, setAutoScroll]);

  // Jump to bottom handler
  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setIsAtBottom(true);
      setAutoScroll(true);
    }
  };

  const getToolResult = () => undefined; // Simplified for now

  const statusColor =
    {
      RUNNING: "bg-yellow-500",
      SERVING: "bg-green-500",
      COMPLETE: "bg-blue-500",
      FAILED: "bg-red-500",
      QUEUED: "bg-gray-500",
      STOPPING: "bg-orange-500",
      DELETING: "bg-orange-500",
      STOPPED: "bg-gray-400",
    }[task.status] ?? "bg-gray-500";

  // Determine effective view mode
  const viewMode = effectiveViewMode;

  // Tool calls overlay component - respect showToolsOverlay prop in both views
  const shouldShowOverlay = showToolsOverlay;

  const ToolCallsOverlay = () => {
    if (!shouldShowOverlay || recentToolCalls.length === 0) return null;
    return (
      <div className="absolute bottom-0 left-0 right-0 bg-black/80 text-white text-xs p-2 font-mono overflow-hidden">
        {recentToolCalls.map((tc) => (
          <div
            key={`${tc.name}-${tc.args}`}
            className="overflow-hidden text-ellipsis whitespace-nowrap"
          >
            <span className="text-blue-400">{tc.name}</span>
            {tc.args && <span className="text-gray-400"> {tc.args}</span>}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div
      className={`relative flex flex-col h-full border rounded-lg overflow-hidden bg-card ${isSelected && showSelectionControls ? "ring-2 ring-blue-600" : ""}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/50">
        <div className="flex items-center gap-2 min-w-0">
          {showSelectionControls && onToggleSelect && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleSelect();
              }}
              className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                isSelected
                  ? "bg-blue-600 border-blue-600 text-white"
                  : "border-muted-foreground/50 hover:border-blue-600"
              }`}
              title={isSelected ? "Deselect task" : "Select task"}
            >
              {isSelected && <Check className="w-3 h-3" />}
            </button>
          )}
          <div className={`w-2 h-2 rounded-full ${statusColor}`} />
          {isGridView ? (
            <>
              <span className="font-medium truncate text-sm">{task.name}</span>
              <Link
                to="/tsk"
                search={{ tasks: task.id }}
                className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground shrink-0"
                title="Open detail view"
              >
                <Maximize2 className="w-3 h-3" />
              </Link>
            </>
          ) : (
            <EditableTaskName
              taskId={task.id}
              name={task.name}
              nameSource={task.name_source}
            />
          )}
          <span className="text-xs text-muted-foreground">({task.id})</span>
        </div>
        <div className="flex items-center gap-1">
          {(isActiveTask || task.status === "QUEUED") && !isTransitioning && (
            <button
              type="button"
              onClick={() => setShowStopDialog(true)}
              disabled={stopTask.isPending || deleteTask.isPending}
              className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500"
              title={isActiveTask ? "Stop task" : "Delete task"}
            >
              {isActiveTask ? (
                <Square className="w-4 h-4 fill-current" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
            </button>
          )}
          {task.status === "STOPPED" && (
            <>
              <button
                type="button"
                onClick={() => continueTask.mutate(task.id)}
                disabled={continueTask.isPending}
                className="p-1.5 rounded hover:bg-green-100 dark:hover:bg-green-900/30 text-green-600"
                title="Continue task"
              >
                {continueTask.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 fill-current" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setShowStopDialog(true)}
                disabled={deleteTask.isPending}
                className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500"
                title="Delete task"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setShowInfo((prev) => !prev)}
            className={`p-1.5 rounded hover:bg-muted ${showInfo ? "bg-muted" : ""}`}
            title="Show task info"
          >
            <Info className="w-4 h-4" />
          </button>
          <span className="text-muted-foreground mx-1">|</span>
          {isGridView ? (
            /* Grid view: terminal/conversation/services toggle */
            <>
              {!isStopped &&
                (task.status === "SERVING" || task.status === "RUNNING") &&
                task.container_id && (
                  <button
                    type="button"
                    onClick={() => handleViewModeChange("terminal")}
                    className={`p-1.5 rounded hover:bg-muted ${viewMode === "terminal" ? "bg-muted" : ""}`}
                    title="Open terminal"
                  >
                    <SquareTerminal className="w-4 h-4" />
                  </button>
                )}
              <button
                type="button"
                onClick={() => handleViewModeChange("conversation")}
                className={`p-1.5 rounded hover:bg-muted ${viewMode === "conversation" ? "bg-muted" : ""}`}
                title="Conversation"
              >
                <MessageSquare className="w-4 h-4" />
              </button>
              {!isStopped &&
                sortedServices.map((svc) => {
                  const cfg = displayConfig[svc.key];
                  if (cfg && !cfg.visible) return null;
                  const svcMode: GridViewMode = `service:${svc.key}`;
                  return (
                    <button
                      key={svc.key}
                      type="button"
                      onClick={() => handleViewModeChange(svcMode)}
                      className={`p-1.5 rounded hover:bg-muted ${viewMode === svcMode ? "bg-muted" : ""}`}
                      title={cfg?.label ?? defaultServiceLabel(svc.key)}
                    >
                      <ServiceIcon
                        name={cfg?.icon ?? "ExternalLink"}
                        className="w-4 h-4"
                      />
                    </button>
                  );
                })}
            </>
          ) : (
            /* Detail view: all options including split */
            <>
              {!isStopped &&
                (task.status === "SERVING" || task.status === "RUNNING") &&
                task.container_id && (
                  <button
                    type="button"
                    onClick={() => handleViewModeChange("terminal")}
                    className={`p-1.5 rounded hover:bg-muted ${viewMode === "terminal" ? "bg-muted" : ""}`}
                    title="Open terminal"
                  >
                    <SquareTerminal className="w-4 h-4" />
                  </button>
                )}
              <button
                type="button"
                onClick={() => handleViewModeChange("conversation")}
                className={`p-1.5 rounded hover:bg-muted ${viewMode === "conversation" ? "bg-muted" : ""}`}
                title="Conversation"
              >
                <MessageSquare className="w-4 h-4" />
              </button>
              {!isStopped &&
                sortedServices.map((svc) => {
                  const cfg = displayConfig[svc.key];
                  if (cfg && !cfg.visible) return null;
                  const svcMode: GridViewMode = `service:${svc.key}`;
                  return (
                    <button
                      key={svc.key}
                      type="button"
                      onClick={() => handleViewModeChange(svcMode)}
                      className={`p-1.5 rounded hover:bg-muted ${viewMode === svcMode ? "bg-muted" : ""}`}
                      title={cfg?.label ?? defaultServiceLabel(svc.key)}
                    >
                      <ServiceIcon
                        name={cfg?.icon ?? "ExternalLink"}
                        className="w-4 h-4"
                      />
                    </button>
                  );
                })}
              {!isStopped && (
                <button
                  type="button"
                  onClick={handleSplitMode}
                  className={`p-1.5 rounded hover:bg-muted ${viewMode === "split" ? "bg-muted" : ""}`}
                  title="Split view"
                >
                  <Columns2 className="w-4 h-4" />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Info Panel */}
      {showInfo && (
        <div className="px-3 py-2 border-b bg-muted/30 text-xs space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-16">Branch:</span>
            <code className="bg-muted px-1.5 py-0.5 rounded flex-1 truncate">
              {task.branch_name}
            </code>
            <button
              type="button"
              onClick={() => handleCopy(task.branch_name, "branch")}
              className="p-1 rounded hover:bg-muted"
              title="Copy branch name"
            >
              {copiedField === "branch" ? (
                <CheckCheck className="w-3 h-3 text-green-500" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </button>
          </div>
          {task.submodules && task.submodules.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground w-16">Submod:</span>
              <span className="text-muted-foreground">
                {task.submodules.join(", ")} (same branch)
              </span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-16">Project:</span>
            <span>{task.project}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-16">
              {task.started_at ? "Started:" : "Created:"}
            </span>
            <span>
              {formatRelativeTime(task.started_at ?? task.created_at)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-16">Status:</span>
            <span
              className={
                task.status === "RUNNING" || task.status === "SERVING"
                  ? "text-green-500"
                  : task.status === "FAILED"
                    ? "text-red-500"
                    : task.status === "COMPLETE"
                      ? "text-blue-500"
                      : task.status === "STOPPING" || task.status === "DELETING"
                        ? "text-orange-500"
                        : ""
              }
            >
              {task.status}
            </span>
          </div>
          {sortedServices.length > 0 && (
            <div className="flex items-center gap-2 pt-1">
              <span className="text-muted-foreground w-16">URLs:</span>
              <div className="flex gap-2 flex-wrap">
                {sortedServices.map((svc) => {
                  const cfg = displayConfig[svc.key];
                  return (
                    <a
                      key={svc.key}
                      href={svc.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-500 hover:underline flex items-center gap-1"
                    >
                      <ServiceIcon name={cfg?.icon ?? "ExternalLink"} />
                      {cfg?.label ?? defaultServiceLabel(svc.key)}
                    </a>
                  );
                })}
              </div>
            </div>
          )}
          {task.copied_repo_path && (
            <div className="flex items-center gap-2 pt-1">
              <span className="text-muted-foreground w-16">Open:</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (task.copied_repo_path)
                      openPath.mutate({
                        path: task.copied_repo_path,
                        target: "explorer",
                      });
                  }}
                  className="text-blue-500 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <FolderOpen className="w-3 h-3" />
                  Explorer
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (task.copied_repo_path)
                      openPath.mutate({
                        path: task.copied_repo_path,
                        target: "vscode",
                      });
                  }}
                  className="text-blue-500 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <Code className="w-3 h-3" />
                  VS Code
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Content — unified CSS-positioned rendering for both grid and detail */}
      <div
        className="flex-1 overflow-hidden relative"
        style={
          viewMode === "terminal"
            ? { background: "#0f1119", borderRadius: "0 0 8px 8px" }
            : undefined
        }
      >
        {/* Conversation */}
        {mountedPanels.has("conversation") && (
          <div
            className="overflow-hidden"
            style={getPanelPositionStyle(
              "conversation",
              viewMode,
              splitLeft,
              splitRight,
            )}
          >
            <div className="relative h-full">
              <div
                ref={scrollRef}
                onScroll={handleScroll}
                className="h-full overflow-auto p-2"
              >
                {conversations.length > 0 ? (
                  <ConversationList
                    conversations={conversations}
                    getToolResult={getToolResult}
                    projectId={task.id}
                    sessionId={task.id}
                    scheduledJobs={[]}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <p className="text-muted-foreground text-sm">
                      Waiting for agent output...
                    </p>
                  </div>
                )}
              </div>
              {conversations.length > 0 && (
                <button
                  type="button"
                  onClick={scrollToBottom}
                  className={`absolute bottom-4 right-8 p-2 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 z-10 transition-all duration-200 ${
                    isAtBottom
                      ? "opacity-0 pointer-events-none scale-90"
                      : "opacity-100 scale-100"
                  }`}
                  title="Scroll to bottom"
                >
                  <ArrowDown className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Service iframes — each stays mounted once loaded */}
        {sortedServices.map((svc) => {
          const cfg = displayConfig[svc.key];
          const svcMode: GridViewMode = `service:${svc.key}`;
          if (!mountedPanels.has(svcMode)) return null;
          const isVnc = cfg?.embedType === "vnc";
          const panelStyle = getPanelPositionStyle(
            svcMode,
            viewMode,
            splitLeft,
            splitRight,
          );
          const isVisible = panelStyle.display !== "none";
          return (
            <div key={svc.key} className="overflow-hidden" style={panelStyle}>
              {isVnc ? (
                <div className="relative h-full">
                  <iframe
                    src={svc.url}
                    className="w-full h-full border-0"
                    title={`${task.name} ${cfg?.label ?? defaultServiceLabel(svc.key)}`}
                  />
                  {isVisible && <ToolCallsOverlay />}
                </div>
              ) : (
                <iframe
                  src={svc.url}
                  className="w-full h-full border-0 bg-white"
                  title={`${task.name} ${cfg?.label ?? defaultServiceLabel(svc.key)}`}
                />
              )}
            </div>
          );
        })}

        {/* Terminal — stays mounted, visibility controlled by prop */}
        {mountedPanels.has("terminal") && task.container_id && (
          <div
            className="overflow-hidden"
            style={getPanelPositionStyle(
              "terminal",
              viewMode,
              splitLeft,
              splitRight,
            )}
          >
            <TerminalPanel
              taskId={task.id}
              visible={
                viewMode === "terminal" ||
                (viewMode === "split" &&
                  (splitLeft === "terminal" || splitRight === "terminal"))
              }
            />
          </div>
        )}

        {/* Split mode: vertical divider */}
        {viewMode === "split" && (
          <div className="absolute top-0 bottom-0 left-1/2 w-px bg-border z-[5]" />
        )}

        {/* Split mode: floating mode selectors */}
        {viewMode === "split" && (
          <>
            {/* Left pane toolbar */}
            <div
              className="absolute top-1 flex gap-0.5 bg-background/80 backdrop-blur-sm rounded p-0.5 z-10"
              style={{ right: "calc(50% + 4px)" }}
            >
              {splitModeOptions.map((opt) => {
                const isDisabled =
                  opt.mode === "terminal" && splitRight === "terminal";
                return (
                  <button
                    key={opt.mode}
                    type="button"
                    onClick={() => !isDisabled && setSplitLeft(opt.mode)}
                    className={`p-1 rounded ${splitLeft === opt.mode ? "bg-muted" : isDisabled ? "opacity-30 cursor-not-allowed" : "hover:bg-muted/50"}`}
                    title={
                      isDisabled
                        ? "Terminal is shown in the other pane"
                        : opt.label
                    }
                  >
                    {opt.mode === "conversation" ? (
                      <MessageSquare className="w-3 h-3" />
                    ) : opt.mode === "terminal" ? (
                      <SquareTerminal className="w-3 h-3" />
                    ) : (
                      <ServiceIcon name={opt.iconName} />
                    )}
                  </button>
                );
              })}
            </div>
            {/* Right pane toolbar */}
            <div className="absolute top-1 right-1 flex gap-0.5 bg-background/80 backdrop-blur-sm rounded p-0.5 z-10">
              {splitModeOptions.map((opt) => {
                const isDisabled =
                  opt.mode === "terminal" && splitLeft === "terminal";
                return (
                  <button
                    key={opt.mode}
                    type="button"
                    onClick={() => !isDisabled && setSplitRight(opt.mode)}
                    className={`p-1 rounded ${splitRight === opt.mode ? "bg-muted" : isDisabled ? "opacity-30 cursor-not-allowed" : "hover:bg-muted/50"}`}
                    title={
                      isDisabled
                        ? "Terminal is shown in the other pane"
                        : opt.label
                    }
                  >
                    {opt.mode === "conversation" ? (
                      <MessageSquare className="w-3 h-3" />
                    ) : opt.mode === "terminal" ? (
                      <SquareTerminal className="w-3 h-3" />
                    ) : (
                      <ServiceIcon name={opt.iconName} />
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Transitional status overlay */}
      {isTransitioning && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/80 backdrop-blur-sm rounded-lg">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">
              {userInitiatedStop || task.status === "STOPPING"
                ? "Stopping task..."
                : "Deleting task..."}
            </span>
          </div>
        </div>
      )}

      <Dialog open={showStopDialog} onOpenChange={setShowStopDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {isActiveTask ? "Stop Task" : "Delete Task"}
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to {isActiveTask ? "stop" : "delete"}{" "}
              <span className="font-medium text-foreground">{task.name}</span>?
              {isActiveTask
                ? " This will stop the container and archive the task."
                : " This will remove the task."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setShowStopDialog(false)}
              className="px-4 py-2 rounded text-sm hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleStopConfirm}
              className="px-4 py-2 rounded text-sm bg-red-600 text-white hover:bg-red-700"
            >
              {isActiveTask ? "Stop" : "Delete"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
