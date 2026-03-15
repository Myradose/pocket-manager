import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ExternalLink,
  Focus,
  FolderOpen,
  MessageSquare,
  Monitor,
  SquareTerminal,
  X,
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
import { tskTasksQuery } from "./queries";
import { TskPane } from "./TskPane";
import { useWorkspacePath } from "./useWorkspacePath";

type TskDashboardProps = {
  taskIds: string[];
};

type GridViewMode = "logs" | "frontend" | "vnc" | "terminal";

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

export const TskDashboard: FC<TskDashboardProps> = ({ taskIds }) => {
  const { data: allTasks, isLoading, error } = useQuery(tskTasksQuery);
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

  // Single task popup state
  const [showSingleTaskPopup, setShowSingleTaskPopup] = useState(false);
  const [popupDismissed, setPopupDismissed] = useState(false);

  // Selection and focus mode state (array preserves selection order)
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [isFocusMode, setIsFocusMode] = useState(false);

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

  // Filter tasks - computed early so we can use it in useEffect
  const allFilteredTasks = useMemo(() => {
    if (!allTasks) return [];
    return taskIds.length > 0
      ? allTasks.filter((t) => taskIds.includes(t.id))
      : allTasks.filter(
          (t) => t.status === "RUNNING" || t.status === "SERVING",
        );
  }, [allTasks, taskIds]);

  // Apply focus mode filter (preserves selection order)
  const tasks = useMemo(() => {
    if (isFocusMode && selectedTaskIds.length > 0) {
      // Map selected IDs to tasks in selection order
      const taskMap = new Map(allFilteredTasks.map((t) => [t.id, t]));
      return selectedTaskIds
        .map((id) => taskMap.get(id))
        .filter((t): t is NonNullable<typeof t> => t !== undefined);
    }
    return allFilteredTasks;
  }, [allFilteredTasks, isFocusMode, selectedTaskIds]);

  // Show popup when there's only 1 task and user hasn't dismissed it
  // Don't show in focus mode - user intentionally selected that one task
  useEffect(() => {
    if (
      tasks.length === 1 &&
      !popupDismissed &&
      taskIds.length === 0 &&
      !isFocusMode
    ) {
      setShowSingleTaskPopup(true);
    } else {
      setShowSingleTaskPopup(false);
    }
  }, [tasks.length, popupDismissed, taskIds.length, isFocusMode]);

  // Redirect to grid if specific task IDs were requested but not found
  useEffect(() => {
    if (taskIds.length > 0 && tasks.length === 0 && !isLoading && !error) {
      navigate({ to: "/tsk", search: {} });
    }
  }, [taskIds.length, tasks.length, isLoading, error, navigate]);

  // Track previous task IDs for view mode inheritance
  const prevTaskIdsRef = useRef<Set<string>>(new Set());

  // Inherit view mode for new tasks when all existing tasks share the same mode
  useEffect(() => {
    const currentTaskIds = new Set(allFilteredTasks.map((t) => t.id));
    const prevTaskIds = prevTaskIdsRef.current;

    // Find new task IDs
    const newTaskIds = [...currentTaskIds].filter((id) => !prevTaskIds.has(id));

    if (newTaskIds.length > 0 && prevTaskIds.size > 0) {
      // Check if all existing tasks have the same view mode
      const existingModes = [...prevTaskIds].map(
        (id) => taskViewModes[id] ?? "terminal",
      );
      const allSameMode = existingModes.every((m) => m === existingModes[0]);

      if (allSameMode && existingModes[0]) {
        const inheritedMode = existingModes[0];
        // Set new tasks to inherit the common view mode
        setTaskViewModes((prev) => {
          const updated = { ...prev };
          newTaskIds.forEach((id) => {
            updated[id] = inheritedMode;
          });
          return updated;
        });
      }
    }

    // Update ref for next comparison
    prevTaskIdsRef.current = currentTaskIds;
  }, [allFilteredTasks, taskViewModes]);

  const handleGoToDetail = useCallback(() => {
    if (tasks.length === 1 && tasks[0]) {
      navigate({ to: "/tsk", search: { tasks: tasks[0].id } });
    }
    setShowSingleTaskPopup(false);
  }, [tasks, navigate]);

  const handleDismissPopup = useCallback(() => {
    setPopupDismissed(true);
    setShowSingleTaskPopup(false);
  }, []);

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

  // Show empty state only when no specific task IDs requested (grid view with no running tasks)
  // If specific IDs were requested but not found, the useEffect above will redirect
  if (allFilteredTasks.length === 0 && taskIds.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <p className="text-muted-foreground">No active TSK tasks found.</p>
        <p className="text-sm text-muted-foreground">
          Start a task with{" "}
          <code className="bg-muted px-1 rounded">tsk run --serve</code> or
          specify task IDs in the URL.
        </p>
        <div className="flex items-center gap-3">
          <CreateTaskDialog />
          <WorkspaceSelector />
        </div>
      </div>
    );
  }

  // If specific task IDs were requested but not found, show loading while redirect happens
  if (tasks.length === 0 && taskIds.length > 0) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-muted-foreground">Redirecting...</p>
      </div>
    );
  }

  // Detail view only when user explicitly navigates to specific task(s) via URL
  // Grid view is default, even with only 1 task running
  const isDetailView = taskIds.length > 0 && tasks.length === 1;

  // Calculate grid layout based on number of tasks
  const gridCols = tasks.length <= 2 ? tasks.length : tasks.length <= 4 ? 2 : 3;

  // Set all tasks to a specific mode
  const setAllTasksViewMode = (mode: GridViewMode) => {
    const newModes: Record<string, GridViewMode> = {};
    tasks.forEach((t) => {
      newModes[t.id] = mode;
    });
    setTaskViewModes(newModes);
  };

  // Determine global toggle state based on individual task modes
  const getGlobalState = (): GridViewMode | "mixed" => {
    const modes = tasks.map((t) => taskViewModes[t.id] ?? "terminal");
    const allLogs = modes.every((m) => m === "logs");
    const allFrontend = modes.every((m) => m === "frontend");
    const allVnc = modes.every((m) => m === "vnc");
    const allTerminal = modes.every((m) => m === "terminal");
    if (allLogs) return "logs";
    if (allFrontend) return "frontend";
    if (allVnc) return "vnc";
    if (allTerminal) return "terminal";
    return "mixed";
  };

  const globalState = getGlobalState();

  return (
    <div className="h-screen w-screen overflow-hidden bg-background flex flex-col relative">
      {/* Header bar */}
      {isDetailView ? (
        <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
          <Link
            to="/tsk"
            search={{}}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to all tasks
          </Link>
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
        </div>
      ) : (
        <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
          <div className="flex items-center gap-3">
            <CreateTaskDialog />
            <WorkspaceSelector />
            <span className="text-sm font-medium text-muted-foreground">
              {isFocusMode
                ? `${tasks.length} focused`
                : `${allFilteredTasks.length} active`}{" "}
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
            <span className="text-xs text-muted-foreground mr-2">
              All tasks:
            </span>
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
              onClick={() => setAllTasksViewMode("logs")}
              className={`flex items-center gap-1 px-2 py-1 rounded text-sm ${
                globalState === "logs"
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted"
              }`}
            >
              <MessageSquare className="w-3 h-3" />
              Conversation
            </button>
            <button
              type="button"
              onClick={() => setAllTasksViewMode("frontend")}
              className={`flex items-center gap-1 px-2 py-1 rounded text-sm ${
                globalState === "frontend"
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted"
              }`}
            >
              <ExternalLink className="w-3 h-3" />
              Frontend
            </button>
            <button
              type="button"
              onClick={() => setAllTasksViewMode("vnc")}
              className={`flex items-center gap-1 px-2 py-1 rounded text-sm ${
                globalState === "vnc"
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted"
              }`}
            >
              <Monitor className="w-3 h-3" />
              VNC
            </button>
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
          </div>
        </div>
      )}

      {/* Single task popup */}
      <div
        className={`absolute top-16 left-1/2 -translate-x-1/2 z-50 bg-card border rounded-lg shadow-lg p-4 flex items-center gap-4 transition-all duration-200 ${
          showSingleTaskPopup
            ? "opacity-100 scale-100 translate-y-0"
            : "opacity-0 scale-95 -translate-y-2 pointer-events-none"
        }`}
      >
        <p className="text-sm">
          Only one task is running. Would you like to view it in detail?
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleGoToDetail}
            className="px-3 py-1.5 rounded text-sm bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Go to detail
          </button>
          <button
            type="button"
            onClick={handleDismissPopup}
            className="p-1.5 rounded hover:bg-muted"
            title="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Task grid or single task */}
      <div
        className="flex-1 overflow-hidden grid gap-1 p-1"
        style={
          isDetailView
            ? undefined
            : {
                gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
                gridTemplateRows: `repeat(${Math.ceil(tasks.length / gridCols)}, 1fr)`,
              }
        }
      >
        {tasks.map((task) => (
          <TskPane
            key={task.id}
            task={task}
            isGridView={!isDetailView}
            viewMode={taskViewModes[task.id] ?? "logs"}
            onViewModeChange={(mode) => setTaskViewMode(task.id, mode)}
            showToolsOverlay={showToolsOverlay}
            isSelected={selectedTaskIds.includes(task.id)}
            onToggleSelect={() => toggleTaskSelection(task.id)}
            showSelectionControls={!isDetailView && !isFocusMode}
            savedScrollPosition={taskScrollPositions[task.id]}
            onScrollPositionChange={(pos) =>
              setTaskScrollPosition(task.id, pos)
            }
            initialAutoScroll={taskAutoScroll[task.id]}
            onAutoScrollChange={(auto) => setTaskAutoScrollState(task.id, auto)}
          />
        ))}
      </div>
    </div>
  );
};
