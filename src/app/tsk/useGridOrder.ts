import { useCallback, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

const subscribe = (callback: () => void) => {
  listeners.add(callback);
  return () => listeners.delete(callback);
};

const storageKey = (workspacePath: string) => `tsk-grid-order:${workspacePath}`;

const getOrderedIds = (workspacePath: string): string[] => {
  try {
    const raw = localStorage.getItem(storageKey(workspacePath));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) {
      return parsed;
    }
  } catch {}
  return [];
};

const setOrderedIds = (workspacePath: string, ids: string[]) => {
  localStorage.setItem(storageKey(workspacePath), JSON.stringify(ids));
  for (const listener of listeners) {
    listener();
  }
};

export const useGridOrder = (workspacePath: string) => {
  const snapshot = useSyncExternalStore(subscribe, () =>
    localStorage.getItem(storageKey(workspacePath)),
  );

  const orderedTaskIds = snapshot ? getOrderedIds(workspacePath) : [];

  const reorder = useCallback(
    (fromIndex: number, toIndex: number) => {
      const current = getOrderedIds(workspacePath);
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      if (moved) {
        next.splice(toIndex, 0, moved);
      }
      setOrderedIds(workspacePath, next);
    },
    [workspacePath],
  );

  const syncOrder = useCallback(
    (activeTaskIds: string[]) => {
      const current = getOrderedIds(workspacePath);
      const activeSet = new Set(activeTaskIds);
      // Keep existing order for known tasks, drop stale ones
      const kept = current.filter((id) => activeSet.has(id));
      const keptSet = new Set(kept);
      // Append new tasks at the end
      const added = activeTaskIds.filter((id) => !keptSet.has(id));
      const merged = [...kept, ...added];
      // Only write if changed
      if (
        merged.length !== current.length ||
        merged.some((id, i) => id !== current[i])
      ) {
        setOrderedIds(workspacePath, merged);
      }
    },
    [workspacePath],
  );

  return { orderedTaskIds, reorder, syncOrder };
};
