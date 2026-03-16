import { ChevronDown, Plus } from "lucide-react";
import { type FC, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
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
        <Button
          size="sm"
          className="bg-green-600 hover:bg-green-700 text-white"
        >
          <Plus className="size-3" />
          New Task
        </Button>
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
              <Label>Repository</Label>
              <div className="flex items-center gap-2 min-w-0">
                <code className="min-w-0 flex-1 px-3 py-2 rounded border bg-muted text-sm truncate block">
                  {workspacePath}
                </code>
                <TooltipIconButton
                  variant="ghost"
                  tooltip="Use a different path"
                  onClick={() => {
                    setShowRepoOverride(true);
                    setRepoOverride(workspacePath);
                  }}
                >
                  <ChevronDown className="size-4" />
                </TooltipIconButton>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="task-repo">Repository Path</Label>
              <Input
                id="task-repo"
                type="text"
                value={showRepoOverride ? repoOverride : ""}
                onChange={(e) => setRepoOverride(e.target.value)}
                placeholder="/path/to/repo"
                required
              />
              <p className="text-xs text-muted-foreground">
                Set a workspace in the dashboard header to remember this.
              </p>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="task-name">
              Name{" "}
              <span className="text-muted-foreground font-normal">
                (optional — auto-generated if empty)
              </span>
            </Label>
            <Input
              id="task-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="calm-river"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createTask.isPending || !effectiveRepoPath}
            >
              {createTask.isPending ? "Creating..." : "Create"}
            </Button>
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
