import { Link, useNavigate } from "@tanstack/react-router";
import {
  CheckCheck,
  Code,
  Columns2,
  Copy,
  FolderOpen,
  GitFork,
  GripVertical,
  Info,
  Loader2,
  Maximize2,
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
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { CreateTaskDialog } from "./CreateTaskDialog";
import { EditableTaskName } from "./EditableTaskName";
import type { ServiceDisplayConfig, TskTask } from "./queries";
import {
  useContinueTskTask,
  useDeleteTskTask,
  useOpenPath,
  useStopTskTask,
} from "./queries";
import { defaultServiceLabel, ServiceIcon } from "./ServiceIcon";
import { TerminalPanel } from "./terminal/TerminalPanel";

export type GridViewMode = "terminal" | `service:${string}`;
type DetailViewMode = GridViewMode | "split";

type TskPaneProps = {
  task: TskTask;
  isGridView?: boolean;
  // Show drag handle in header (grid view)
  isDraggable?: boolean;
  // Controlled view mode (used for both grid and detail view)
  viewMode?: GridViewMode;
  onViewModeChange?: (mode: GridViewMode) => void;
  // Selection state for focus mode
  isSelected?: boolean;
  onToggleSelect?: () => void;
  showSelectionControls?: boolean;
  // Service display config from settings
  displayConfig?: Record<string, ServiceDisplayConfig>;
  // Panel mounting controlled by parent (grid view LRU)
  mountedPanels?: Set<GridViewMode>;
  onPanelMount?: (mode: GridViewMode) => void;
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
  isDraggable = false,
  viewMode: controlledViewMode = "terminal",
  onViewModeChange,
  isSelected = false,
  onToggleSelect,
  showSelectionControls = false,
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
  const [showForkDialog, setShowForkDialog] = useState(false);

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
      navigate({ to: "/", search: {} });
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
        navigate({ to: "/", search: {} });
      }
    }
  }, [task.id, isActiveTask, isGridView, stopTask, deleteTask, navigate]);

  // Track if split mode is active (detail view only feature)
  const [isSplitMode, setIsSplitMode] = useState(false);
  const splitStorageKey = `tsk-split:${task.repo_root}`;
  const [splitLeft, _setSplitLeft] = useState<GridViewMode>("terminal");
  const [splitRight, _setSplitRight] = useState<GridViewMode>("terminal");

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

  const [panelGenerations, setPanelGenerations] = useState<
    Record<string, number>
  >({});
  const [showInfo, setShowInfo] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Reset split mode when switching to grid view
  useEffect(() => {
    if (isGridView) {
      setIsSplitMode(false);
    }
  }, [isGridView]);

  const isStopped = task.status === "STOPPED";

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

  const handleViewModeChange = (mode: GridViewMode) => {
    if (mode === controlledViewMode && !isSplitMode) {
      // Terminal/iframes need actual remount to reconnect WebSocket / reload
      setPanelGenerations((prev) => ({
        ...prev,
        [mode]: (prev[mode] ?? 0) + 1,
      }));
    }
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
          setSplitRight("terminal");
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

  return (
    <div
      className={`relative flex flex-col h-full border rounded-lg overflow-hidden bg-card ${isSelected && showSelectionControls ? "ring-2 ring-blue-600" : ""}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/50">
        <div className="flex items-center gap-2 min-w-0">
          {isDraggable && (
            <GripVertical className="size-3.5 text-muted-foreground cursor-grab shrink-0" />
          )}
          {showSelectionControls && onToggleSelect && (
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => onToggleSelect()}
              onClick={(e) => e.stopPropagation()}
              className="data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
              aria-label={isSelected ? "Deselect pocket" : "Select pocket"}
            />
          )}
          <div className={`w-2 h-2 rounded-full ${statusColor}`} />
          {isGridView ? (
            <>
              <span className="font-medium truncate text-sm">{task.name}</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    to="/"
                    search={{ tasks: task.id }}
                    className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground shrink-0"
                  >
                    <Maximize2 className="size-3" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent>Open detail view</TooltipContent>
              </Tooltip>
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
            <TooltipIconButton
              variant="ghost"
              tooltip={isActiveTask ? "Stop pocket" : "Delete pocket"}
              className="h-7 w-7 p-1.5 hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500"
              onClick={() => setShowStopDialog(true)}
              disabled={stopTask.isPending || deleteTask.isPending}
            >
              {isActiveTask ? (
                <Square className="size-4 fill-current" />
              ) : (
                <Trash2 className="size-4" />
              )}
            </TooltipIconButton>
          )}
          {task.status === "STOPPED" && (
            <>
              <TooltipIconButton
                variant="ghost"
                tooltip="Continue pocket"
                className="h-7 w-7 p-1.5 hover:bg-green-100 dark:hover:bg-green-900/30 text-green-600"
                onClick={() => continueTask.mutate(task.id)}
                disabled={continueTask.isPending}
              >
                {continueTask.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Play className="size-4 fill-current" />
                )}
              </TooltipIconButton>
              <TooltipIconButton
                variant="ghost"
                tooltip="Delete pocket"
                className="h-7 w-7 p-1.5 hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500"
                onClick={() => setShowStopDialog(true)}
                disabled={deleteTask.isPending}
              >
                <Trash2 className="size-4" />
              </TooltipIconButton>
            </>
          )}
          {!isTransitioning && (
            <TooltipIconButton
              variant="ghost"
              tooltip="Fork pocket"
              className="h-7 w-7 p-1.5 hover:bg-blue-100 dark:hover:bg-blue-900/30 text-blue-500"
              onClick={() => setShowForkDialog(true)}
            >
              <GitFork className="size-4" />
            </TooltipIconButton>
          )}
          <TooltipIconButton
            variant="ghost"
            tooltip="Show pocket info"
            className={`h-7 w-7 p-1.5 ${showInfo ? "bg-muted" : ""}`}
            onClick={() => setShowInfo((prev) => !prev)}
          >
            <Info className="size-4" />
          </TooltipIconButton>
          <div className="w-px h-4 mx-1 bg-muted-foreground/30 shrink-0" />
          {isGridView ? (
            /* Grid view: terminal/services toggle */
            <>
              {!isStopped &&
                (task.status === "SERVING" || task.status === "RUNNING") &&
                task.container_id && (
                  <TooltipIconButton
                    variant="ghost"
                    tooltip="Open terminal"
                    className={`h-7 w-7 p-1.5 ${viewMode === "terminal" ? "bg-muted" : ""}`}
                    onClick={() => handleViewModeChange("terminal")}
                  >
                    <SquareTerminal className="size-4" />
                  </TooltipIconButton>
                )}
              {!isStopped &&
                sortedServices.map((svc) => {
                  const cfg = displayConfig[svc.key];
                  if (cfg && !cfg.visible) return null;
                  const svcMode: GridViewMode = `service:${svc.key}`;
                  return (
                    <TooltipIconButton
                      key={svc.key}
                      variant="ghost"
                      tooltip={cfg?.label ?? defaultServiceLabel(svc.key)}
                      className={`h-7 w-7 p-1.5 ${viewMode === svcMode ? "bg-muted" : ""}`}
                      onClick={() => handleViewModeChange(svcMode)}
                    >
                      <ServiceIcon
                        name={cfg?.icon ?? "ExternalLink"}
                        className="size-4"
                      />
                    </TooltipIconButton>
                  );
                })}
            </>
          ) : (
            /* Detail view: all options including split */
            <>
              {!isStopped &&
                (task.status === "SERVING" || task.status === "RUNNING") &&
                task.container_id && (
                  <TooltipIconButton
                    variant="ghost"
                    tooltip="Open terminal"
                    className={`h-7 w-7 p-1.5 ${viewMode === "terminal" ? "bg-muted" : ""}`}
                    onClick={() => handleViewModeChange("terminal")}
                  >
                    <SquareTerminal className="size-4" />
                  </TooltipIconButton>
                )}
              {!isStopped &&
                sortedServices.map((svc) => {
                  const cfg = displayConfig[svc.key];
                  if (cfg && !cfg.visible) return null;
                  const svcMode: GridViewMode = `service:${svc.key}`;
                  return (
                    <TooltipIconButton
                      key={svc.key}
                      variant="ghost"
                      tooltip={cfg?.label ?? defaultServiceLabel(svc.key)}
                      className={`h-7 w-7 p-1.5 ${viewMode === svcMode ? "bg-muted" : ""}`}
                      onClick={() => handleViewModeChange(svcMode)}
                    >
                      <ServiceIcon
                        name={cfg?.icon ?? "ExternalLink"}
                        className="size-4"
                      />
                    </TooltipIconButton>
                  );
                })}
              {!isStopped && (
                <TooltipIconButton
                  variant="ghost"
                  tooltip="Split view"
                  className={`h-7 w-7 p-1.5 ${viewMode === "split" ? "bg-muted" : ""}`}
                  onClick={handleSplitMode}
                >
                  <Columns2 className="size-4" />
                </TooltipIconButton>
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
            <TooltipIconButton
              variant="ghost"
              tooltip="Copy branch name"
              className="h-6 w-6 p-1"
              onClick={() => handleCopy(task.branch_name, "branch")}
            >
              {copiedField === "branch" ? (
                <CheckCheck className="size-3 text-green-500" />
              ) : (
                <Copy className="size-3" />
              )}
            </TooltipIconButton>
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
                <Button
                  variant="link"
                  className="h-auto p-0 text-blue-500 gap-1"
                  onClick={() => {
                    if (task.copied_repo_path)
                      openPath.mutate({
                        path: task.copied_repo_path,
                        target: "explorer",
                      });
                  }}
                >
                  <FolderOpen className="size-3" />
                  Explorer
                </Button>
                <Button
                  variant="link"
                  className="h-auto p-0 text-blue-500 gap-1"
                  onClick={() => {
                    if (task.copied_repo_path)
                      openPath.mutate({
                        path: task.copied_repo_path,
                        target: "vscode",
                      });
                  }}
                >
                  <Code className="size-3" />
                  VS Code
                </Button>
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
          return (
            <div
              key={`${svc.key}-${panelGenerations[svcMode] ?? 0}`}
              className="overflow-hidden"
              style={panelStyle}
            >
              <iframe
                src={svc.url}
                className={`w-full h-full border-0 ${isVnc ? "" : "bg-white"}`}
                title={`${task.name} ${cfg?.label ?? defaultServiceLabel(svc.key)}`}
              />
            </div>
          );
        })}

        {/* Terminal — stays mounted, visibility controlled by prop */}
        {mountedPanels.has("terminal") && task.container_id && (
          <div
            key={`terminal-${panelGenerations.terminal ?? 0}`}
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
              className="absolute top-1 flex gap-0.5 bg-background/80 backdrop-blur-sm rounded p-0.5 z-10 opacity-30 hover:opacity-100 transition-opacity"
              style={{ right: "calc(50% + 4px)" }}
            >
              {splitModeOptions.map((opt) => {
                const isDisabled =
                  opt.mode === "terminal" && splitRight === "terminal";
                return (
                  <TooltipIconButton
                    key={opt.mode}
                    variant="ghost"
                    tooltip={
                      isDisabled
                        ? "Terminal is shown in the other pane"
                        : opt.label
                    }
                    className={`h-6 w-6 p-1 ${splitLeft === opt.mode ? "bg-muted" : isDisabled ? "opacity-30 cursor-not-allowed" : ""}`}
                    onClick={() => !isDisabled && setSplitLeft(opt.mode)}
                  >
                    {opt.mode === "terminal" ? (
                      <SquareTerminal className="size-4" />
                    ) : (
                      <ServiceIcon name={opt.iconName} />
                    )}
                  </TooltipIconButton>
                );
              })}
            </div>
            {/* Right pane toolbar */}
            <div className="absolute top-1 right-1 flex gap-0.5 bg-background/80 backdrop-blur-sm rounded p-0.5 z-10 opacity-30 hover:opacity-100 transition-opacity">
              {splitModeOptions.map((opt) => {
                const isDisabled =
                  opt.mode === "terminal" && splitLeft === "terminal";
                return (
                  <TooltipIconButton
                    key={opt.mode}
                    variant="ghost"
                    tooltip={
                      isDisabled
                        ? "Terminal is shown in the other pane"
                        : opt.label
                    }
                    className={`h-6 w-6 p-1 ${splitRight === opt.mode ? "bg-muted" : isDisabled ? "opacity-30 cursor-not-allowed" : ""}`}
                    onClick={() => !isDisabled && setSplitRight(opt.mode)}
                  >
                    {opt.mode === "terminal" ? (
                      <SquareTerminal className="size-4" />
                    ) : (
                      <ServiceIcon name={opt.iconName} />
                    )}
                  </TooltipIconButton>
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
                ? "Stopping pocket..."
                : "Deleting pocket..."}
            </span>
          </div>
        </div>
      )}

      <Dialog open={showStopDialog} onOpenChange={setShowStopDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {isActiveTask ? "Stop Pocket" : "Delete Pocket"}
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to {isActiveTask ? "stop" : "delete"}{" "}
              <span className="font-medium text-foreground">{task.name}</span>?
              {isActiveTask
                ? " This will stop the container and archive the pocket."
                : " This will remove the pocket."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowStopDialog(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleStopConfirm}>
              {isActiveTask ? "Stop" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CreateTaskDialog
        forkFrom={{
          taskId: task.id,
          repoRoot: task.repo_root,
          taskName: task.name,
        }}
        open={showForkDialog}
        onOpenChange={setShowForkDialog}
      />
    </div>
  );
};
