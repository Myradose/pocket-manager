import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Focus,
  FolderOpen,
  Loader2,
  Play,
  Settings,
  SquareTerminal,
  Trash2,
  XCircle,
} from "lucide-react";
import {
  type FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { CreateTaskDialog } from "./CreateTaskDialog";
import { EditableTaskName } from "./EditableTaskName";
import {
  type ServiceDisplayConfig,
  type TskTask,
  tskServiceDisplayConfigQuery,
  tskTasksQuery,
  useContinueTskTask,
  useDeleteTskTask,
} from "./queries";
import { defaultServiceLabel, ServiceIcon } from "./ServiceIcon";
import { ServiceSettingsDialog } from "./ServiceSettingsDialog";
import { type GridViewMode, TskPane } from "./TskPane";
import { useWorkspacePath } from "./useWorkspacePath";

type TskDashboardProps = {
  taskIds: string[];
};

/** Max number of inactive (non-active-view) panels kept mounted across all grid tasks */
const GRID_PANEL_LRU_CAP = 8;
const GRID_CELL_MIN_HEIGHT = 320;

type PanelKey = `${string}\0${GridViewMode}`;
const toPanelKey = (taskId: string, mode: GridViewMode): PanelKey =>
  `${taskId}\0${mode}`;
const fromPanelKey = (
  key: PanelKey,
): { taskId: string; mode: GridViewMode } => {
  const idx = key.indexOf("\0");
  return {
    taskId: key.slice(0, idx),
    mode: key.slice(idx + 1) as GridViewMode,
  };
};

const WorkspaceSelector: FC = () => {
  const { workspacePath, setWorkspacePath } = useWorkspacePath();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");

  const handleStartEdit = () => {
    setEditValue(workspacePath);
    setIsEditing(true);
  };

  const handleSave = () => {
    setWorkspacePath(editValue.trim());
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-1">
        <FolderOpen className="size-3 text-muted-foreground shrink-0" />
        <Input
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSave}
          className="h-6 px-2 py-0.5 text-xs font-mono w-56"
          placeholder="/path/to/repo"
        />
      </div>
    );
  }

  if (!workspacePath) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 text-xs text-muted-foreground"
        onClick={handleStartEdit}
      >
        <FolderOpen className="size-3" />
        Set workspace
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 gap-1 px-2 text-xs min-w-0"
      onClick={handleStartEdit}
      title={workspacePath}
    >
      <FolderOpen className="size-3 text-muted-foreground shrink-0" />
      <span className="font-mono truncate max-w-48">{workspacePath}</span>
    </Button>
  );
};

// Format relative time (e.g., "2 min ago")
const formatRelativeTime = (dateString: string | null): string => {
  if (!dateString) return "";
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);

  if (diffSec < 60) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  return date.toLocaleDateString();
};

const StoppedTaskRow: FC<{ task: TskTask }> = ({ task }) => {
  const continueTask = useContinueTskTask();
  const deleteTask = useDeleteTskTask();

  const statusColor =
    {
      STOPPED: "bg-gray-400",
      QUEUED: "bg-gray-500",
    }[task.status] ?? "bg-gray-500";

  const isResuming = continueTask.isPending || task.status === "QUEUED";

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 hover:bg-muted/50 rounded text-sm group">
      <div className={`w-2 h-2 rounded-full shrink-0 ${statusColor}`} />
      <EditableTaskName
        taskId={task.id}
        name={task.name}
        nameSource={task.name_source}
        className="font-medium truncate text-sm"
      />
      <span className="text-xs text-muted-foreground shrink-0">{task.id}</span>
      <code className="text-xs text-muted-foreground truncate hidden sm:block max-w-48">
        {task.branch_name}
      </code>
      <span className="text-xs text-muted-foreground shrink-0 ml-auto">
        {formatRelativeTime(task.started_at ?? task.created_at)}
      </span>
      <div className="flex items-center gap-1 shrink-0">
        <TooltipIconButton
          variant="ghost"
          tooltip="Continue task"
          className="h-6 w-6 p-1 text-green-600 hover:bg-green-100 dark:hover:bg-green-900/30"
          onClick={() => continueTask.mutate(task.id)}
          disabled={isResuming}
        >
          {isResuming ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Play className="size-3.5 fill-current" />
          )}
        </TooltipIconButton>
        <TooltipIconButton
          variant="ghost"
          tooltip="Delete task"
          className="h-6 w-6 p-1 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => deleteTask.mutate(task.id)}
          disabled={deleteTask.isPending}
        >
          <Trash2 className="size-3.5" />
        </TooltipIconButton>
      </div>
    </div>
  );
};

export const TskDashboard: FC<TskDashboardProps> = ({ taskIds }) => {
  const { workspacePath } = useWorkspacePath();
  const {
    data: allTasks,
    isLoading,
    error,
  } = useQuery(tskTasksQuery(workspacePath || undefined));
  const navigate = useNavigate();

  // Track individual task view modes
  const [taskViewModes, setTaskViewModes] = useState<
    Record<string, GridViewMode>
  >({});

  // Global LRU for grid panel mounting — tracks all mounted panels across grid tasks
  // Ordered oldest-first: index 0 is the least recently used
  const [gridPanelLru, setGridPanelLru] = useState<PanelKey[]>([]);

  // Compute mounted panels per task from LRU + always include the active view mode
  const getTaskMountedPanels = useCallback(
    (taskId: string): Set<GridViewMode> => {
      const activeMode = taskViewModes[taskId] ?? "terminal";
      const panels = new Set<GridViewMode>([activeMode]);
      for (const key of gridPanelLru) {
        const parsed = fromPanelKey(key);
        if (parsed.taskId === taskId) {
          panels.add(parsed.mode);
        }
      }
      return panels;
    },
    [gridPanelLru, taskViewModes],
  );

  // Handle a grid task requesting a new panel to be mounted
  const handleGridPanelMount = useCallback(
    (taskId: string, mode: GridViewMode) => {
      setGridPanelLru((prev) => {
        const key = toPanelKey(taskId, mode);
        // If already in LRU, move to end (most recently used)
        const without = prev.filter((k) => k !== key);
        const next = [...without, key];
        // Evict oldest entries that exceed the cap, but never evict
        // a panel that is the active view mode for its task
        while (next.length > GRID_PANEL_LRU_CAP) {
          const evictIdx = next.findIndex((k) => {
            const parsed = fromPanelKey(k);
            const activeMode = taskViewModes[parsed.taskId] ?? "terminal";
            return parsed.mode !== activeMode;
          });
          if (evictIdx === -1) break; // all are active, can't evict
          next.splice(evictIdx, 1);
        }
        return next;
      });
    },
    [taskViewModes],
  );

  // Selection and focus mode state (array preserves selection order)
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [isFocusMode, setIsFocusMode] = useState(false);

  // Stopped tasks strip collapsed state
  const [stoppedCollapsed, setStoppedCollapsed] = useState(true);

  // Service settings dialog
  const [showServiceSettings, setShowServiceSettings] = useState(false);

  // Fetch service display config
  const { data: serviceDisplayConfig } = useQuery({
    ...tskServiceDisplayConfigQuery(workspacePath || ""),
    enabled: !!workspacePath,
  });
  const displayConfig: Record<string, ServiceDisplayConfig> =
    serviceDisplayConfig ?? {};

  // Update a single task's view mode and add both old+new modes to the grid LRU
  const setTaskViewMode = useCallback(
    (taskId: string, mode: GridViewMode) => {
      const oldMode = taskViewModes[taskId] ?? "terminal";
      setTaskViewModes((prev) => ({ ...prev, [taskId]: mode }));
      // Add old mode (so it persists after switch) and new mode (touch as most recent)
      setGridPanelLru((prev) => {
        const oldKey = toPanelKey(taskId, oldMode);
        const newKey = toPanelKey(taskId, mode);
        const next = prev.filter((k) => k !== oldKey && k !== newKey);
        // Old mode first (less recent), new mode last (most recent)
        if (oldMode !== mode) next.push(oldKey);
        next.push(newKey);
        // Evict if over cap — never evict a task's current active mode
        while (next.length > GRID_PANEL_LRU_CAP) {
          const evictIdx = next.findIndex((k) => {
            const parsed = fromPanelKey(k);
            // Protect the new active mode for this task
            if (parsed.taskId === taskId) return parsed.mode !== mode;
            // Protect other tasks' active modes
            const activeMode = taskViewModes[parsed.taskId] ?? "terminal";
            return parsed.mode !== activeMode;
          });
          if (evictIdx === -1) break;
          next.splice(evictIdx, 1);
        }
        return next;
      });
    },
    [taskViewModes],
  );

  // Toggle task selection (maintains selection order)
  const toggleTaskSelection = useCallback((taskId: string) => {
    setSelectedTaskIds((prev) => {
      const index = prev.indexOf(taskId);
      if (index >= 0) {
        return prev.filter((_, i) => i !== index);
      } else {
        return [...prev, taskId];
      }
    });
  }, []);

  // Enter focus mode with selected tasks
  const enterFocusMode = useCallback(() => {
    if (selectedTaskIds.length > 0) {
      setIsFocusMode(true);
    }
  }, [selectedTaskIds.length]);

  // Exit focus mode
  const exitFocusMode = useCallback(() => {
    setIsFocusMode(false);
    setSelectedTaskIds([]);
  }, []);

  // Split tasks into active and stopped
  const allFilteredTasks = useMemo(() => {
    if (!allTasks) return [];
    if (taskIds.length > 0) {
      return allTasks.filter((t) => taskIds.includes(t.id));
    }
    return allTasks.filter(
      (t) =>
        t.status === "RUNNING" ||
        t.status === "SERVING" ||
        t.status === "STOPPED",
    );
  }, [allTasks, taskIds]);

  const activeTasks = useMemo(
    () => allFilteredTasks.filter((t) => t.status !== "STOPPED"),
    [allFilteredTasks],
  );

  const stoppedTasks = useMemo(
    () =>
      (allTasks ?? [])
        .filter((t) => t.status === "STOPPED")
        .sort((a, b) => {
          const dateA = a.started_at ?? a.created_at;
          const dateB = b.started_at ?? b.created_at;
          return new Date(dateB).getTime() - new Date(dateA).getTime();
        }),
    [allTasks],
  );

  // Apply focus mode filter to active tasks (preserves selection order)
  const tasks = useMemo(() => {
    if (isFocusMode && selectedTaskIds.length > 0) {
      const taskMap = new Map(activeTasks.map((t) => [t.id, t]));
      return selectedTaskIds
        .map((id) => taskMap.get(id))
        .filter((t): t is NonNullable<typeof t> => t !== undefined);
    }
    return activeTasks;
  }, [activeTasks, isFocusMode, selectedTaskIds]);

  // Compute union of all service keys across active tasks, sorted by display config order
  const allServiceKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const t of tasks) {
      for (const s of t.services) {
        keys.add(s.key);
      }
    }
    return [...keys].sort((a, b) => {
      const orderA = displayConfig[a]?.order ?? 0;
      const orderB = displayConfig[b]?.order ?? 0;
      return orderA - orderB;
    });
  }, [tasks, displayConfig]);

  // Redirect to grid if specific task IDs were requested but not found
  useEffect(() => {
    if (
      taskIds.length > 0 &&
      allFilteredTasks.length === 0 &&
      !isLoading &&
      !error
    ) {
      navigate({ to: "/", search: {} });
    }
  }, [taskIds.length, allFilteredTasks.length, isLoading, error, navigate]);

  // Track previous task IDs for view mode inheritance
  const prevTaskIdsRef = useRef<Set<string>>(new Set());

  // Inherit view mode for new tasks when all existing tasks share the same mode
  useEffect(() => {
    const currentTaskIds = new Set(activeTasks.map((t) => t.id));
    const prevTaskIds = prevTaskIdsRef.current;

    const newTaskIds = [...currentTaskIds].filter((id) => !prevTaskIds.has(id));

    if (newTaskIds.length > 0 && prevTaskIds.size > 0) {
      const existingModes = [...prevTaskIds].map(
        (id) => taskViewModes[id] ?? "terminal",
      );
      const allSameMode = existingModes.every((m) => m === existingModes[0]);

      if (allSameMode && existingModes[0]) {
        const inheritedMode = existingModes[0];
        setTaskViewModes((prev) => {
          const updated = { ...prev };
          newTaskIds.forEach((id) => {
            updated[id] = inheritedMode;
          });
          return updated;
        });
      }
    }

    prevTaskIdsRef.current = currentTaskIds;
  }, [activeTasks, taskViewModes]);

  // Detail view only when user explicitly navigates to specific task(s) via URL
  const isDetailView = taskIds.length > 0 && allFilteredTasks.length === 1;
  const detailTaskId = isDetailView ? (allFilteredTasks[0]?.id ?? null) : null;

  // Include the detail task in the render list even if it's stopped (not in `tasks`)
  const renderTasks = useMemo(() => {
    if (!detailTaskId) return tasks;
    if (tasks.some((t) => t.id === detailTaskId)) return tasks;
    const detailTask = allFilteredTasks.find((t) => t.id === detailTaskId);
    if (!detailTask) return tasks;
    return [detailTask, ...tasks];
  }, [detailTaskId, allFilteredTasks, tasks]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-muted-foreground">Loading TSK tasks...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-destructive">Error loading tasks: {error.message}</p>
      </div>
    );
  }

  // If specific task IDs were requested but not found, show loading while redirect happens
  if (allFilteredTasks.length === 0 && taskIds.length > 0) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-muted-foreground">Redirecting...</p>
      </div>
    );
  }

  // Grid layout: cap columns at 3, rows auto-sized with min height
  const gridCols =
    tasks.length <= 2 ? Math.max(tasks.length, 1) : tasks.length <= 4 ? 2 : 3;
  const gridRows = Math.ceil(tasks.length / gridCols);

  // Set all active tasks to a specific mode
  const setAllTasksViewMode = (mode: GridViewMode) => {
    const newModes: Record<string, GridViewMode> = {};
    tasks.forEach((t) => {
      newModes[t.id] = mode;
    });
    setTaskViewModes(newModes);
    // Add old modes to LRU so they persist, and new mode as most recent
    setGridPanelLru((prev) => {
      const keysToRemove = new Set<PanelKey>();
      const toAdd: PanelKey[] = [];
      for (const t of tasks) {
        const oldMode = taskViewModes[t.id] ?? "terminal";
        const oldKey = toPanelKey(t.id, oldMode);
        const newKey = toPanelKey(t.id, mode);
        keysToRemove.add(oldKey);
        keysToRemove.add(newKey);
        if (oldMode !== mode) toAdd.push(oldKey);
        toAdd.push(newKey);
      }
      const next = prev.filter((k) => !keysToRemove.has(k));
      next.push(...toAdd);
      while (next.length > GRID_PANEL_LRU_CAP) {
        const evictIdx = next.findIndex((k) => {
          const parsed = fromPanelKey(k);
          return parsed.mode !== mode;
        });
        if (evictIdx === -1) break;
        next.splice(evictIdx, 1);
      }
      return next;
    });
  };

  // Determine global toggle state based on active task modes
  const getGlobalState = (): GridViewMode | "mixed" => {
    if (tasks.length === 0) return "terminal";
    const modes = tasks.map((t) => taskViewModes[t.id] ?? "terminal");
    const first = modes[0];
    if (first && modes.every((m) => m === first)) return first;
    return "mixed";
  };

  const globalState = getGlobalState();

  // No active tasks — show create prompt with stopped tasks if any
  if (tasks.length === 0 && taskIds.length === 0) {
    return (
      <div className="h-screen w-screen overflow-hidden bg-background flex flex-col">
        <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
          <div className="flex items-center gap-3">
            <CreateTaskDialog />
            <WorkspaceSelector />
          </div>
        </div>
        <div className="flex-1 flex flex-col min-h-0">
          <div className="px-4 pt-6 pb-3">
            <p className="text-muted-foreground">No active tasks running.</p>
            <p className="text-sm text-muted-foreground mt-1">
              {stoppedTasks.length > 0
                ? "Continue a stopped task or create a new one."
                : "Create a new task to get started."}
            </p>
          </div>
          {stoppedTasks.length > 0 && (
            <>
              <div className="px-3 pb-2 text-sm font-medium text-muted-foreground">
                Stopped ({stoppedTasks.length})
              </div>
              <ScrollArea className="flex-1 px-1 pb-2">
                {stoppedTasks.map((task) => (
                  <StoppedTaskRow key={task.id} task={task} />
                ))}
              </ScrollArea>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-background flex flex-col">
      {/* Conditional header */}
      {detailTaskId ? (
        <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30 shrink-0">
          <Link
            to="/"
            search={{}}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Back to all tasks
          </Link>
          <div className="flex items-center gap-1">
            <TooltipIconButton
              variant="ghost"
              tooltip="Service display settings"
              className="h-7 w-7 p-1.5"
              onClick={() => setShowServiceSettings(true)}
            >
              <Settings className="size-4" />
            </TooltipIconButton>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30 shrink-0">
          <div className="flex items-center gap-3">
            <CreateTaskDialog />
            <WorkspaceSelector />
            <span className="text-sm font-medium text-muted-foreground">
              {isFocusMode
                ? `${tasks.length} focused`
                : `${activeTasks.length} active`}{" "}
              {tasks.length === 1 ? "task" : "tasks"}
            </span>
            {!isFocusMode && selectedTaskIds.length > 0 && (
              <span className="text-xs text-muted-foreground">
                ({selectedTaskIds.length} selected)
              </span>
            )}
            {!isFocusMode && selectedTaskIds.length > 0 && (
              <Button
                size="sm"
                className="bg-blue-600 hover:bg-blue-700 text-white h-7 gap-1"
                onClick={enterFocusMode}
              >
                <Focus className="size-3" />
                Focus
              </Button>
            )}
            {isFocusMode && (
              <Button
                size="sm"
                className="bg-orange-600 hover:bg-orange-700 text-white h-7 gap-1"
                onClick={exitFocusMode}
              >
                <XCircle className="size-3" />
                Exit Focus
              </Button>
            )}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground mr-2">
              All tasks:
            </span>
            <ToggleGroup
              type="single"
              value={globalState === "mixed" ? "" : globalState}
              onValueChange={(v) => {
                if (v) setAllTasksViewMode(v as GridViewMode);
              }}
            >
              <ToggleGroupItem
                value="terminal"
                className="gap-1 px-2 h-7 text-sm data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
              >
                <SquareTerminal className="size-4" />
                Terminal
              </ToggleGroupItem>
              {allServiceKeys.map((key) => {
                const cfg = displayConfig[key];
                if (cfg && !cfg.visible) return null;
                const svcMode: GridViewMode = `service:${key}`;
                return (
                  <ToggleGroupItem
                    key={key}
                    value={svcMode}
                    className="gap-1 px-2 h-7 text-sm data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                  >
                    <ServiceIcon name={cfg?.icon ?? "ExternalLink"} />
                    {cfg?.label ?? defaultServiceLabel(key)}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
            <div className="w-px h-4 mx-2 bg-muted-foreground/30 shrink-0" />
            <TooltipIconButton
              variant="ghost"
              tooltip="Service display settings"
              className="h-7 w-7 p-1.5"
              onClick={() => setShowServiceSettings(true)}
            >
              <Settings className="size-4" />
            </TooltipIconButton>
          </div>
        </div>
      )}

      {/* Unified task container */}
      <div className="flex-1 overflow-auto p-1 min-h-0">
        <div
          className={detailTaskId ? "h-full" : "grid gap-1 h-full"}
          style={
            detailTaskId
              ? undefined
              : {
                  gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
                  gridTemplateRows: `repeat(${gridRows}, minmax(${GRID_CELL_MIN_HEIGHT}px, 1fr))`,
                  minHeight:
                    gridRows > 1
                      ? `${gridRows * GRID_CELL_MIN_HEIGHT}px`
                      : "100%",
                }
          }
        >
          {renderTasks.map((task) => {
            const isDetail = task.id === detailTaskId;
            const isHidden = detailTaskId != null && !isDetail;
            return (
              <div
                key={task.id}
                className={isDetail ? "h-full" : ""}
                style={isHidden ? { display: "none" } : undefined}
              >
                <TskPane
                  task={task}
                  isGridView={!isDetail}
                  viewMode={taskViewModes[task.id] ?? "terminal"}
                  onViewModeChange={(mode) => setTaskViewMode(task.id, mode)}
                  isSelected={!isDetail && selectedTaskIds.includes(task.id)}
                  onToggleSelect={
                    !isDetail ? () => toggleTaskSelection(task.id) : undefined
                  }
                  showSelectionControls={!isDetail && !isFocusMode}
                  displayConfig={displayConfig}
                  mountedPanels={
                    !isDetail ? getTaskMountedPanels(task.id) : undefined
                  }
                  onPanelMount={
                    !isDetail
                      ? (mode) => handleGridPanelMount(task.id, mode)
                      : undefined
                  }
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Stopped tasks strip — grid only */}
      {!detailTaskId && stoppedTasks.length > 0 && (
        <Collapsible
          open={!stoppedCollapsed}
          onOpenChange={(open) => setStoppedCollapsed(!open)}
          className="border-t bg-muted/20 shrink-0"
        >
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="w-full justify-start gap-2 px-3 py-1.5 h-auto text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              {stoppedCollapsed ? (
                <ChevronRight className="size-4" />
              ) : (
                <ChevronDown className="size-4" />
              )}
              Stopped ({stoppedTasks.length})
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ScrollArea className="max-h-48">
              <div className="pb-1">
                {stoppedTasks.map((task) => (
                  <StoppedTaskRow key={task.id} task={task} />
                ))}
              </div>
            </ScrollArea>
          </CollapsibleContent>
        </Collapsible>
      )}

      {workspacePath && (
        <ServiceSettingsDialog
          open={showServiceSettings}
          onOpenChange={setShowServiceSettings}
          workspacePath={workspacePath}
          allServiceKeys={allServiceKeys}
          displayConfig={displayConfig}
        />
      )}
    </div>
  );
};
