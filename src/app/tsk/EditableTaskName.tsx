import { Check, Loader2, Pencil, Sparkles, X } from "lucide-react";
import { type FC, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { useRenameTskTask, useSuggestTskTaskName } from "./queries";

type EditableTaskNameProps = {
  taskId: string;
  name: string;
  nameSource?: string;
  className?: string;
};

export const EditableTaskName: FC<EditableTaskNameProps> = ({
  taskId,
  name,
  nameSource,
  className = "font-medium truncate text-sm",
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const renameTask = useRenameTskTask();
  const suggestName = useSuggestTskTaskName();

  const isAutoNamed = nameSource === "auto";

  const startEditing = (initialValue?: string) => {
    setEditValue(initialValue ?? name);
    setIsEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const handleSave = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== name) {
      renameTask.mutate({ taskId, name: trimmed });
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") setIsEditing(false);
  };

  const handleSuggest = () => {
    suggestName.mutate(taskId, {
      onSuccess: (data) => {
        if (data.name) {
          startEditing(data.name);
        }
      },
    });
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-1 min-w-0">
        <Input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSave}
          className="h-6 px-1.5 py-0.5 text-sm font-medium font-mono w-64"
        />
        <TooltipIconButton
          variant="ghost"
          tooltip="Save"
          className="h-5 w-5 p-0.5 text-green-600"
          onMouseDown={(e) => {
            e.preventDefault();
            handleSave();
          }}
        >
          <Check className="size-3" />
        </TooltipIconButton>
        <TooltipIconButton
          variant="ghost"
          tooltip="Cancel"
          className="h-5 w-5 p-0.5 text-muted-foreground"
          onMouseDown={(e) => {
            e.preventDefault();
            setIsEditing(false);
          }}
        >
          <X className="size-3" />
        </TooltipIconButton>
      </div>
    );
  }

  return (
    <div className="flex items-center min-w-0 group/name">
      <span
        className={`${className} ${isAutoNamed ? "italic text-muted-foreground" : ""}`}
      >
        {name}
      </span>
      {isAutoNamed && (
        <TooltipIconButton
          variant="ghost"
          tooltip="Auto-named — click to suggest a name (AI)"
          className="h-5 w-5 p-0.5 text-amber-500 ml-1 shrink-0 disabled:opacity-50"
          onClick={handleSuggest}
          disabled={suggestName.isPending}
        >
          {suggestName.isPending ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Sparkles className="size-3" />
          )}
        </TooltipIconButton>
      )}
      <div className="hidden group-hover/name:flex items-center gap-0.5 ml-1 shrink-0">
        <TooltipIconButton
          variant="ghost"
          tooltip="Rename task"
          className="h-5 w-5 p-0.5 text-muted-foreground"
          onClick={() => startEditing()}
        >
          <Pencil className="size-3" />
        </TooltipIconButton>
        {!isAutoNamed && (
          <TooltipIconButton
            variant="ghost"
            tooltip="Suggest name (AI)"
            className="h-5 w-5 p-0.5 text-muted-foreground disabled:opacity-50"
            onClick={handleSuggest}
            disabled={suggestName.isPending}
          >
            {suggestName.isPending ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Sparkles className="size-3" />
            )}
          </TooltipIconButton>
        )}
      </div>
    </div>
  );
};
