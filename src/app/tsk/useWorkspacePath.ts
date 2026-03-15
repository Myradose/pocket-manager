import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "tsk-workspace-path";

const listeners = new Set<() => void>();

const subscribe = (callback: () => void) => {
  listeners.add(callback);
  return () => listeners.delete(callback);
};

const getSnapshot = () => localStorage.getItem(STORAGE_KEY) ?? "";

const setWorkspacePathValue = (path: string) => {
  if (path) {
    localStorage.setItem(STORAGE_KEY, path);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
  for (const listener of listeners) {
    listener();
  }
};

export const useWorkspacePath = () => {
  const workspacePath = useSyncExternalStore(subscribe, getSnapshot);

  const setWorkspacePath = useCallback((path: string) => {
    setWorkspacePathValue(path);
  }, []);

  return { workspacePath, setWorkspacePath };
};
