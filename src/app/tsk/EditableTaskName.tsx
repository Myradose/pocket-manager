import { Check, Loader2, Pencil, Sparkles, X } from "lucide-react";
import { type FC, useRef, useState } from "react";
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
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSave}
          className="px-1.5 py-0.5 rounded border bg-background text-sm font-medium font-mono w-64"
        />
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            handleSave();
          }}
          className="p-0.5 rounded hover:bg-muted text-green-600"
          title="Save"
        >
          <Check className="w-3 h-3" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            setIsEditing(false);
          }}
          className="p-0.5 rounded hover:bg-muted text-muted-foreground"
          title="Cancel"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 min-w-0 group/name">
      <span
        className={`${className} ${isAutoNamed ? "italic text-muted-foreground" : ""}`}
      >
        {name}
      </span>
      <button
        type="button"
        onClick={() => startEditing()}
        className="p-0.5 rounded hover:bg-muted text-muted-foreground opacity-0 group-hover/name:opacity-100 transition-opacity shrink-0"
        title="Rename task"
      >
        <Pencil className="w-3 h-3" />
      </button>
      <button
        type="button"
        onClick={handleSuggest}
        disabled={suggestName.isPending}
        className={`p-0.5 rounded hover:bg-muted shrink-0 disabled:opacity-50 ${
          isAutoNamed
            ? "text-amber-500 opacity-100"
            : "text-muted-foreground opacity-0 group-hover/name:opacity-100 transition-opacity"
        }`}
        title={
          isAutoNamed
            ? "Auto-named — click to suggest a name (AI)"
            : "Suggest name (AI)"
        }
      >
        {suggestName.isPending ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <Sparkles className="w-3 h-3" />
        )}
      </button>
    </div>
  );
};
