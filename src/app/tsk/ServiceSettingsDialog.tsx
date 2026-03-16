import { Eye, EyeOff, FolderOpen, GripVertical, RotateCcw } from "lucide-react";
import { type FC, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
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

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          className="w-full flex items-center gap-2 px-2 py-1 rounded border bg-background text-sm hover:bg-muted/50"
        >
          <ServiceIcon name={value} />
          <span className="flex-1 text-left">{value}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1" align="start">
        {ICON_OPTIONS.map((icon) => (
          <button
            key={icon}
            type="button"
            onClick={() => {
              onChange(icon);
              setIsOpen(false);
            }}
            className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-muted ${
              icon === value ? "bg-muted" : ""
            }`}
          >
            <ServiceIcon name={icon} />
            <span>{icon}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
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
      <DialogContent
        className="max-w-lg"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Service Display Settings</DialogTitle>
        </DialogHeader>
        {orderedKeys.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No services discovered. Services will appear when tasks are running.
          </p>
        ) : (
          <ScrollArea className="max-h-80 pr-2">
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
                          <GripVertical className="size-3.5 text-muted-foreground cursor-grab shrink-0" />
                        ) : (
                          <div className="w-3.5" />
                        )}
                        <ServiceIcon name={cfg.icon} />
                        <code className="text-xs bg-muted px-1 rounded">
                          {key}
                        </code>
                      </div>
                      <div className="flex items-center gap-2">
                        <TooltipIconButton
                          variant="ghost"
                          tooltip="Reset to defaults"
                          className="h-6 w-6 p-1 text-muted-foreground"
                          onClick={() => handleResetKey(key)}
                        >
                          <RotateCcw className="size-3.5" />
                        </TooltipIconButton>
                        <TooltipIconButton
                          variant="ghost"
                          tooltip={
                            cfg.visible ? "Hide service" : "Show service"
                          }
                          className={`h-6 w-6 p-1 ${cfg.visible ? "text-foreground" : "text-muted-foreground/40"}`}
                          onClick={() =>
                            updateField(key, "visible", !cfg.visible)
                          }
                        >
                          {cfg.visible ? (
                            <Eye className="size-3.5" />
                          ) : (
                            <EyeOff className="size-3.5" />
                          )}
                        </TooltipIconButton>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <Label
                          htmlFor={`svc-label-${key}`}
                          className="text-xs text-muted-foreground"
                        >
                          Label
                        </Label>
                        <Input
                          id={`svc-label-${key}`}
                          type="text"
                          value={cfg.label}
                          onChange={(e) =>
                            updateField(key, "label", e.target.value)
                          }
                          className="h-8 text-sm"
                        />
                      </div>
                      <div>
                        <Label
                          htmlFor={`svc-icon-${key}`}
                          className="text-xs text-muted-foreground"
                        >
                          Icon
                        </Label>
                        <IconPicker
                          id={`svc-icon-${key}`}
                          value={cfg.icon}
                          onChange={(icon) => updateField(key, "icon", icon)}
                        />
                      </div>
                      <div>
                        <Label
                          htmlFor={`svc-embed-${key}`}
                          className="text-xs text-muted-foreground"
                        >
                          Embed Type
                        </Label>
                        <Select
                          value={cfg.embedType}
                          onValueChange={(v) =>
                            updateField(key, "embedType", v)
                          }
                        >
                          <SelectTrigger
                            id={`svc-embed-${key}`}
                            className="h-8 text-sm"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="iframe">iframe</SelectItem>
                            <SelectItem value="vnc">vnc</SelectItem>
                          </SelectContent>
                        </Select>
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
                        <Separator className="flex-1" />
                        <span className="text-xs text-muted-foreground shrink-0">
                          Hidden
                        </span>
                        <Separator className="flex-1" />
                      </div>
                      <div className="space-y-1">
                        {hiddenKeys.map((key) => renderCard(key, false))}
                      </div>
                    </>
                  )}
                </>
              );
            })()}
          </ScrollArea>
        )}
        <DialogFooter>
          <div className="flex items-center gap-2 mr-auto">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleResetAll}
              className="text-muted-foreground"
            >
              <RotateCcw className="size-3.5" />
              Reset All
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleOpenConfig}
              className="text-muted-foreground"
            >
              <FolderOpen className="size-3.5" />
              Open Config
            </Button>
          </div>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={updateConfig.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
