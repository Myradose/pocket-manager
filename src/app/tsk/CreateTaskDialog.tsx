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

type CreateTaskDialogProps = {
  forkFrom?: {
    taskId: string;
    repoRoot: string;
    taskName: string;
  };
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export const CreateTaskDialog: FC<CreateTaskDialogProps> = ({
  forkFrom,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const [name, setName] = useState("");
  const [showRepoOverride, setShowRepoOverride] = useState(false);
  const [repoOverride, setRepoOverride] = useState("");
  const { workspacePath } = useWorkspacePath();

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled
    ? (v: boolean) => controlledOnOpenChange?.(v)
    : setInternalOpen;

  const createTask = useCreateTskTask();

  const effectiveRepoPath = forkFrom
    ? forkFrom.repoRoot
    : showRepoOverride
      ? repoOverride
      : workspacePath;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createTask.mutate(
      {
        repo_path: effectiveRepoPath,
        name: name || undefined,
        serve: true,
        ...(forkFrom ? { from_task: forkFrom.taskId } : {}),
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

  const dialogContent = (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>
          {forkFrom ? "Fork Pocket" : "Create New Pocket"}
        </DialogTitle>
        <DialogDescription>
          {forkFrom ? (
            <>
              Create a new pocket forked from{" "}
              <strong>{forkFrom.taskName}</strong>
              's committed git state.
            </>
          ) : (
            "Spawn a new pocket. Claude Code will start interactively inside the container."
          )}
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4 min-w-0">
        {forkFrom ? (
          <div className="space-y-1">
            <Label>Repository</Label>
            <code className="min-w-0 w-full px-3 py-2 rounded border bg-muted text-sm truncate block">
              {forkFrom.repoRoot}
            </code>
          </div>
        ) : workspacePath && !showRepoOverride ? (
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
            {createTask.isPending
              ? "Creating..."
              : forkFrom
                ? "Fork"
                : "Create"}
          </Button>
        </DialogFooter>
        {createTask.isError && (
          <p className="text-sm text-destructive">{createTask.error.message}</p>
        )}
      </form>
    </DialogContent>
  );

  if (isControlled) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        {dialogContent}
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          className="bg-green-600 hover:bg-green-700 text-white"
        >
          <Plus className="size-3" />
          New Pocket
        </Button>
      </DialogTrigger>
      {dialogContent}
    </Dialog>
  );
};
