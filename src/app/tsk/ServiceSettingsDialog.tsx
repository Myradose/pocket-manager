import { Eye, EyeOff, FolderOpen, GripVertical, RotateCcw } from "lucide-react";
import { type FC, useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  type ServiceDisplayConfig,
  useOpenPath,
  useUpdateServiceDisplayConfig,
} from "./queries";
import { defaultServiceLabel, ServiceIcon } from "./ServiceIcon";

const ICON_OPTIONS = [
  "Globe",
  "Monitor",
  "ExternalLink",
  "Server",
  "Eye",
  "Layout",
  "Terminal",
];

const defaultConfigForKey = (key: string): ServiceDisplayConfig => ({
  label: defaultServiceLabel(key),
  icon: key === "vnc" ? "Monitor" : "ExternalLink",
  visible: true,
  order: 0,
  embedType: key === "vnc" ? "vnc" : "iframe",
});

const IconPicker: FC<{
  value: string;
  onChange: (icon: string) => void;
  id: string;
}> = ({ value, onChange, id }) => {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  return (
    <div ref={ref} className="relative" id={id}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full flex items-center gap-2 px-2 py-1 rounded border bg-background text-sm hover:bg-muted/50"
      >
        <ServiceIcon name={value} />
        <span className="flex-1 text-left">{value}</span>
      </button>
      {isOpen && (
        <div className="absolute z-50 top-full left-0 mt-1 w-full bg-popover border rounded shadow-md max-h-40 overflow-y-auto scrollbar-thin">
          {ICON_OPTIONS.map((icon) => (
            <button
              key={icon}
              type="button"
              onClick={() => {
                onChange(icon);
                setIsOpen(false);
              }}
              className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-muted ${
                icon === value ? "bg-muted" : ""
              }`}
            >
              <ServiceIcon name={icon} />
              <span>{icon}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

type ServiceSettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspacePath: string;
  allServiceKeys: string[];
  displayConfig: Record<string, ServiceDisplayConfig>;
};

export const ServiceSettingsDialog: FC<ServiceSettingsDialogProps> = ({
  open,
  onOpenChange,
  workspacePath,
  allServiceKeys,
  displayConfig,
}) => {
  const updateConfig = useUpdateServiceDisplayConfig();
  const openPath = useOpenPath();
  const [localConfig, setLocalConfig] = useState<
    Record<string, ServiceDisplayConfig>
  >({});
  // Explicit ordering — array of keys in display order
  const [orderedKeys, setOrderedKeys] = useState<string[]>([]);

  // Drag state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Sync from props only when dialog transitions from closed to open
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      const merged: Record<string, ServiceDisplayConfig> = {};
      for (const key of allServiceKeys) {
        merged[key] = displayConfig[key] ?? defaultConfigForKey(key);
      }
      setLocalConfig(merged);
      // Initialize order from config order values, with stable tiebreaker
      const sorted = [...allServiceKeys].sort((a, b) => {
        const orderA = merged[a]?.order ?? 0;
        const orderB = merged[b]?.order ?? 0;
        if (orderA !== orderB) return orderA - orderB;
        return allServiceKeys.indexOf(a) - allServiceKeys.indexOf(b);
      });
      setOrderedKeys(sorted);
    }
    prevOpenRef.current = open;
  }, [open, allServiceKeys, displayConfig]);

  const updateField = (
    key: string,
    field: keyof ServiceDisplayConfig,
    value: string | boolean | number,
  ) => {
    setLocalConfig((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? defaultConfigForKey(key)), [field]: value },
    }));
  };

  const handleResetKey = (key: string) => {
    setLocalConfig((prev) => ({
      ...prev,
      [key]: defaultConfigForKey(key),
    }));
  };

  const handleResetAll = () => {
    const defaults: Record<string, ServiceDisplayConfig> = {};
    for (const key of allServiceKeys) {
      defaults[key] = defaultConfigForKey(key);
    }
    setLocalConfig(defaults);
    setOrderedKeys([...allServiceKeys]);
  };

  // Assign order values from array position before saving
  const handleSave = () => {
    const withOrder: Record<string, ServiceDisplayConfig> = {};
    for (let i = 0; i < orderedKeys.length; i++) {
      const key = orderedKeys[i];
      if (key) {
        withOrder[key] = {
          ...(localConfig[key] ?? defaultConfigForKey(key)),
          order: i,
        };
      }
    }
    updateConfig.mutate({
      projectPath: workspacePath,
      services: withOrder,
    });
    onOpenChange(false);
  };

  const handleOpenConfig = () => {
    openPath.mutate({
      path: "~/.claude-code-viewer/cache/",
      target: "explorer",
    });
  };

  // Drag and drop handlers
  const handleDragStart = useCallback((index: number) => {
    setDragIndex(index);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      if (dragIndex === null || dragIndex === index) return;
      setDragOverIndex(index);
    },
    [dragIndex],
  );

  const handleDrop = useCallback(
    (index: number) => {
      if (dragIndex === null || dragIndex === index) {
        setDragIndex(null);
        setDragOverIndex(null);
        return;
      }
      setOrderedKeys((prev) => {
        const next = [...prev];
        const [moved] = next.splice(dragIndex, 1);
        if (moved) {
          next.splice(index, 0, moved);
        }
        return next;
      });
      setDragIndex(null);
      setDragOverIndex(null);
    },
    [dragIndex],
  );

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDragOverIndex(null);
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Service Display Settings</DialogTitle>
        </DialogHeader>
        {orderedKeys.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No services discovered. Services will appear when tasks are running.
          </p>
        ) : (
          <div className="max-h-80 overflow-y-auto scrollbar-thin pr-2">
            {(() => {
              const visibleKeys = orderedKeys.filter(
                (k) => localConfig[k]?.visible !== false,
              );
              const hiddenKeys = orderedKeys.filter(
                (k) => localConfig[k]?.visible === false,
              );

              const renderCard = (key: string, dragEnabled: boolean) => {
                const cfg = localConfig[key] ?? defaultConfigForKey(key);
                const globalIndex = orderedKeys.indexOf(key);
                const isDragging = dragEnabled && dragIndex === globalIndex;
                const isDragOver = dragEnabled && dragOverIndex === globalIndex;
                return (
                  <div
                    key={key}
                    draggable={dragEnabled}
                    onDragStart={
                      dragEnabled
                        ? () => handleDragStart(globalIndex)
                        : undefined
                    }
                    onDragOver={
                      dragEnabled
                        ? (e) => handleDragOver(e, globalIndex)
                        : undefined
                    }
                    onDrop={
                      dragEnabled ? () => handleDrop(globalIndex) : undefined
                    }
                    onDragEnd={dragEnabled ? handleDragEnd : undefined}
                    className={`border rounded p-3 space-y-2 text-sm transition-all ${
                      isDragging ? "opacity-40" : ""
                    } ${isDragOver ? "border-primary border-dashed" : ""} ${
                      !cfg.visible ? "opacity-60" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 font-medium">
                        {dragEnabled ? (
                          <GripVertical className="w-3 h-3 text-muted-foreground cursor-grab shrink-0" />
                        ) : (
                          <div className="w-3" />
                        )}
                        <ServiceIcon name={cfg.icon} />
                        <code className="text-xs bg-muted px-1 rounded">
                          {key}
                        </code>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleResetKey(key)}
                          className="p-1 rounded hover:bg-muted text-muted-foreground"
                          title="Reset to defaults"
                        >
                          <RotateCcw className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            updateField(key, "visible", !cfg.visible)
                          }
                          className={`p-1 rounded hover:bg-muted ${cfg.visible ? "text-foreground" : "text-muted-foreground/40"}`}
                          title={cfg.visible ? "Hide service" : "Show service"}
                        >
                          {cfg.visible ? (
                            <Eye className="w-3.5 h-3.5" />
                          ) : (
                            <EyeOff className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label
                          htmlFor={`svc-label-${key}`}
                          className="text-xs text-muted-foreground"
                        >
                          Label
                        </label>
                        <input
                          id={`svc-label-${key}`}
                          type="text"
                          value={cfg.label}
                          onChange={(e) =>
                            updateField(key, "label", e.target.value)
                          }
                          className="w-full px-2 py-1 rounded border bg-background text-sm"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor={`svc-icon-${key}`}
                          className="text-xs text-muted-foreground"
                        >
                          Icon
                        </label>
                        <IconPicker
                          id={`svc-icon-${key}`}
                          value={cfg.icon}
                          onChange={(icon) => updateField(key, "icon", icon)}
                        />
                      </div>
                      <div>
                        <label
                          htmlFor={`svc-embed-${key}`}
                          className="text-xs text-muted-foreground"
                        >
                          Embed Type
                        </label>
                        <select
                          id={`svc-embed-${key}`}
                          value={cfg.embedType}
                          onChange={(e) =>
                            updateField(key, "embedType", e.target.value)
                          }
                          className="w-full px-2 py-1 rounded border bg-background text-sm"
                        >
                          <option value="iframe">iframe</option>
                          <option value="vnc">vnc</option>
                        </select>
                      </div>
                    </div>
                  </div>
                );
              };

              return (
                <>
                  <div className="space-y-1">
                    {visibleKeys.map((key) => renderCard(key, true))}
                  </div>
                  {hiddenKeys.length > 0 && (
                    <>
                      <div className="flex items-center gap-2 py-2 px-1">
                        <div className="flex-1 border-t" />
                        <span className="text-xs text-muted-foreground shrink-0">
                          Hidden
                        </span>
                        <div className="flex-1 border-t" />
                      </div>
                      <div className="space-y-1">
                        {hiddenKeys.map((key) => renderCard(key, false))}
                      </div>
                    </>
                  )}
                </>
              );
            })()}
          </div>
        )}
        <DialogFooter>
          <div className="flex items-center gap-2 mr-auto">
            <button
              type="button"
              onClick={handleResetAll}
              className="flex items-center gap-1.5 px-3 py-2 rounded text-sm hover:bg-muted text-muted-foreground"
              title="Reset all services to defaults"
            >
              <RotateCcw className="w-3 h-3" />
              Reset All
            </button>
            <button
              type="button"
              onClick={handleOpenConfig}
              className="flex items-center gap-1.5 px-3 py-2 rounded text-sm hover:bg-muted text-muted-foreground"
              title="Open config directory"
            >
              <FolderOpen className="w-3 h-3" />
              Open Config
            </button>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 rounded text-sm hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={updateConfig.isPending}
            className="px-4 py-2 rounded text-sm bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Save
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
