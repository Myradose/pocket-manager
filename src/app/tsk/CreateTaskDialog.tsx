import { Plus } from "lucide-react";
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

export const CreateTaskDialog: FC = () => {
  const [open, setOpen] = useState(false);
  const [repoPath, setRepoPath] = useState("");
  const [name, setName] = useState("");
  const [serve, setServe] = useState(true);

  const createTask = useCreateTskTask();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createTask.mutate(
      {
        repo_path: repoPath,
        name: name || undefined,
        serve,
      },
      {
        onSuccess: () => {
          setOpen(false);
          setRepoPath("");
          setName("");
          setServe(true);
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
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="task-repo" className="text-sm font-medium">
              Repository Path
            </label>
            <input
              id="task-repo"
              type="text"
              value={repoPath}
              onChange={(e) => setRepoPath(e.target.value)}
              className="w-full px-3 py-2 rounded border bg-background text-sm"
              placeholder="/path/to/repo"
              required
            />
          </div>
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
          <div className="flex items-center gap-2">
            <input
              id="task-serve"
              type="checkbox"
              checked={serve}
              onChange={(e) => setServe(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="task-serve" className="text-sm">
              Enable serve mode (container stays running)
            </label>
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
              disabled={createTask.isPending || !repoPath}
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
