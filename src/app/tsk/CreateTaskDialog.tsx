import { ChevronDown, Plus } from "lucide-react";
import { type FC, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useCreateTskTask } from "./queries";
import { useWorkspacePath } from "./useWorkspacePath";

export const CreateTaskDialog: FC = () => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [showRepoOverride, setShowRepoOverride] = useState(false);
  const [repoOverride, setRepoOverride] = useState("");
  const { workspacePath } = useWorkspacePath();

  const createTask = useCreateTskTask();

  const effectiveRepoPath = showRepoOverride ? repoOverride : workspacePath;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createTask.mutate(
      {
        repo_path: effectiveRepoPath,
        name: name || undefined,
        serve: true,
      },
      {
        onSuccess: () => {
          setOpen(false);
          setName("");
          setShowRepoOverride(false);
          setRepoOverride("");
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 px-2 py-1 rounded text-sm bg-green-600 text-white hover:bg-green-700"
        >
          <Plus className="w-3 h-3" />
          New Task
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create New Task</DialogTitle>
          <DialogDescription>
            Spawn a new tsk container. Claude Code will start interactively
            inside the container.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 min-w-0">
          {workspacePath && !showRepoOverride ? (
            <div className="space-y-1">
              <span className="text-sm font-medium">Repository</span>
              <div className="flex items-center gap-2 min-w-0">
                <code className="min-w-0 flex-1 px-3 py-2 rounded border bg-muted text-sm truncate block">
                  {workspacePath}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    setShowRepoOverride(true);
                    setRepoOverride(workspacePath);
                  }}
                  className="shrink-0 p-2 rounded hover:bg-muted text-muted-foreground"
                  title="Use a different path"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <label htmlFor="task-repo" className="text-sm font-medium">
                Repository Path
              </label>
              <input
                id="task-repo"
                type="text"
                value={showRepoOverride ? repoOverride : ""}
                onChange={(e) => setRepoOverride(e.target.value)}
                className="w-full px-3 py-2 rounded border bg-background text-sm"
                placeholder="/path/to/repo"
                required
              />
              <p className="text-xs text-muted-foreground">
                Set a workspace in the dashboard header to remember this.
              </p>
            </div>
          )}
          <div className="space-y-2">
            <label htmlFor="task-name" className="text-sm font-medium">
              Name{" "}
              <span className="text-muted-foreground font-normal">
                (optional — auto-generated if empty)
              </span>
            </label>
            <input
              id="task-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded border bg-background text-sm"
              placeholder="calm-river"
            />
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-4 py-2 rounded text-sm hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createTask.isPending || !effectiveRepoPath}
              className="px-4 py-2 rounded text-sm bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {createTask.isPending ? "Creating..." : "Create"}
            </button>
          </DialogFooter>
          {createTask.isError && (
            <p className="text-sm text-destructive">
              {createTask.error.message}
            </p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
};
