import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Focus,
  FolderOpen,
  Loader2,
  MessageSquare,
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
import { TskPane } from "./TskPane";
import { useWorkspacePath } from "./useWorkspacePath";

type TskDashboardProps = {
  taskIds: string[];
};

type GridViewMode = "conversation" | "terminal" | `service:${string}`;

const GRID_CELL_MIN_HEIGHT = 320;

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
        <FolderOpen className="w-3 h-3 text-muted-foreground shrink-0" />
        <input
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSave}
          className="px-2 py-0.5 rounded border bg-background text-xs font-mono w-56"
          placeholder="/path/to/repo"
        />
      </div>
    );
  }

  if (!workspacePath) {
    return (
      <button
        type="button"
        onClick={handleStartEdit}
        className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:bg-muted"
      >
        <FolderOpen className="w-3 h-3" />
        Set workspace
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleStartEdit}
      className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-muted min-w-0"
      title={workspacePath}
    >
      <FolderOpen className="w-3 h-3 text-muted-foreground shrink-0" />
      <span className="font-mono truncate max-w-48">{workspacePath}</span>
    </button>
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
        <button
          type="button"
          onClick={() => continueTask.mutate(task.id)}
          disabled={isResuming}
          className="p-1 rounded hover:bg-green-100 dark:hover:bg-green-900/30 text-green-600 disabled:opacity-50"
          title="Continue task"
        >
          {isResuming ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Play className="w-3.5 h-3.5 fill-current" />
          )}
        </button>
        <button
          type="button"
          onClick={() => deleteTask.mutate(task.id)}
          disabled={deleteTask.isPending}
          className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
          title="Delete task"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
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

  // Track individual task scroll positions and autoScroll state
  const [taskScrollPositions, setTaskScrollPositions] = useState<
    Record<string, number>
  >({});
  const [taskAutoScroll, setTaskAutoScroll] = useState<Record<string, boolean>>(
    {},
  );

  // Toggle for showing tool calls overlay on VNC
  const [showToolsOverlay, setShowToolsOverlay] = useState(true);

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

  // Update a single task's view mode
  const setTaskViewMode = useCallback((taskId: string, mode: GridViewMode) => {
    setTaskViewModes((prev) => ({ ...prev, [taskId]: mode }));
  }, []);

  // Update a single task's scroll position
  const setTaskScrollPosition = useCallback(
    (taskId: string, position: number) => {
      setTaskScrollPositions((prev) => ({ ...prev, [taskId]: position }));
    },
    [],
  );

  // Update a single task's autoScroll state
  const setTaskAutoScrollState = useCallback(
    (taskId: string, autoScroll: boolean) => {
      setTaskAutoScroll((prev) => ({ ...prev, [taskId]: autoScroll }));
    },
    [],
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
      navigate({ to: "/tsk", search: {} });
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

  // Detail view only when user explicitly navigates to specific task(s) via URL
  const isDetailView = taskIds.length > 0 && allFilteredTasks.length === 1;

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

  // For the detail view with a specific task requested
  if (isDetailView) {
    const detailTask = allFilteredTasks[0];
    if (!detailTask) return null;

    return (
      <div className="h-screen w-screen overflow-hidden bg-background flex flex-col">
        <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
          <Link
            to="/tsk"
            search={{}}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to all tasks
          </Link>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowToolsOverlay((prev) => !prev)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-sm ${
                showToolsOverlay
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted"
              }`}
              title="Toggle tool calls overlay on VNC"
            >
              <MessageSquare className="w-3 h-3" />
              Tools
            </button>
            <button
              type="button"
              onClick={() => setShowServiceSettings(true)}
              className="p-1.5 rounded hover:bg-muted"
              title="Service display settings"
            >
              <Settings className="w-3 h-3" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden p-1">
          <TskPane
            key={detailTask.id}
            task={detailTask}
            isGridView={false}
            viewMode={
              taskViewModes[detailTask.id] ??
              (detailTask.status === "STOPPED" ? "conversation" : "terminal")
            }
            onViewModeChange={(mode) => setTaskViewMode(detailTask.id, mode)}
            showToolsOverlay={showToolsOverlay}
            isSelected={false}
            showSelectionControls={false}
            savedScrollPosition={taskScrollPositions[detailTask.id]}
            onScrollPositionChange={(pos) =>
              setTaskScrollPosition(detailTask.id, pos)
            }
            initialAutoScroll={taskAutoScroll[detailTask.id]}
            onAutoScrollChange={(auto) =>
              setTaskAutoScrollState(detailTask.id, auto)
            }
            displayConfig={displayConfig}
          />
        </div>
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
  }

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
              <div className="flex-1 overflow-y-auto px-1 pb-2">
                {stoppedTasks.map((task) => (
                  <StoppedTaskRow key={task.id} task={task} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-background flex flex-col">
      {/* Header bar */}
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
            <button
              type="button"
              onClick={enterFocusMode}
              className="flex items-center gap-1 px-2 py-1 rounded text-sm bg-blue-600 text-white hover:bg-blue-700"
            >
              <Focus className="w-3 h-3" />
              Focus
            </button>
          )}
          {isFocusMode && (
            <button
              type="button"
              onClick={exitFocusMode}
              className="flex items-center gap-1 px-2 py-1 rounded text-sm bg-orange-600 text-white hover:bg-orange-700"
            >
              <XCircle className="w-3 h-3" />
              Exit Focus
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground mr-2">All tasks:</span>
          <button
            type="button"
            onClick={() => setAllTasksViewMode("terminal")}
            className={`flex items-center gap-1 px-2 py-1 rounded text-sm ${
              globalState === "terminal"
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted"
            }`}
          >
            <SquareTerminal className="w-3 h-3" />
            Terminal
          </button>
          <button
            type="button"
            onClick={() => setAllTasksViewMode("conversation")}
            className={`flex items-center gap-1 px-2 py-1 rounded text-sm ${
              globalState === "conversation"
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted"
            }`}
          >
            <MessageSquare className="w-3 h-3" />
            Conversation
          </button>
          {allServiceKeys.map((key) => {
            const cfg = displayConfig[key];
            if (cfg && !cfg.visible) return null;
            const svcMode: GridViewMode = `service:${key}`;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setAllTasksViewMode(svcMode)}
                className={`flex items-center gap-1 px-2 py-1 rounded text-sm ${
                  globalState === svcMode
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
              >
                <ServiceIcon name={cfg?.icon ?? "ExternalLink"} />
                {cfg?.label ?? defaultServiceLabel(key)}
              </button>
            );
          })}
          <span className="text-muted-foreground mx-2">|</span>
          <button
            type="button"
            onClick={() => setShowToolsOverlay((prev) => !prev)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-sm ${
              showToolsOverlay
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted"
            }`}
            title="Toggle tool calls overlay on VNC"
          >
            <MessageSquare className="w-3 h-3" />
            Tools
          </button>
          <button
            type="button"
            onClick={() => setShowServiceSettings(true)}
            className="p-1.5 rounded hover:bg-muted"
            title="Service display settings"
          >
            <Settings className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Active task grid — scrollable */}
      <div className="flex-1 overflow-auto p-1 min-h-0">
        <div
          className="grid gap-1 h-full"
          style={{
            gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
            gridTemplateRows: `repeat(${gridRows}, minmax(${GRID_CELL_MIN_HEIGHT}px, 1fr))`,
            minHeight:
              gridRows > 1 ? `${gridRows * GRID_CELL_MIN_HEIGHT}px` : "100%",
          }}
        >
          {tasks.map((task) => (
            <TskPane
              key={task.id}
              task={task}
              isGridView
              viewMode={taskViewModes[task.id] ?? "terminal"}
              onViewModeChange={(mode) => setTaskViewMode(task.id, mode)}
              showToolsOverlay={showToolsOverlay}
              isSelected={selectedTaskIds.includes(task.id)}
              onToggleSelect={() => toggleTaskSelection(task.id)}
              showSelectionControls={!isFocusMode}
              savedScrollPosition={taskScrollPositions[task.id]}
              onScrollPositionChange={(pos) =>
                setTaskScrollPosition(task.id, pos)
              }
              initialAutoScroll={taskAutoScroll[task.id]}
              onAutoScrollChange={(auto) =>
                setTaskAutoScrollState(task.id, auto)
              }
              displayConfig={displayConfig}
            />
          ))}
        </div>
      </div>

      {/* Stopped tasks strip */}
      {stoppedTasks.length > 0 && (
        <div className="border-t bg-muted/20 shrink-0">
          <button
            type="button"
            onClick={() => setStoppedCollapsed((prev) => !prev)}
            className="flex items-center gap-2 px-3 py-1.5 w-full text-left text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            {stoppedCollapsed ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
            Stopped ({stoppedTasks.length})
          </button>
          {!stoppedCollapsed && (
            <div className="max-h-48 overflow-y-auto pb-1">
              {stoppedTasks.map((task) => (
                <StoppedTaskRow key={task.id} task={task} />
              ))}
            </div>
          )}
        </div>
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
