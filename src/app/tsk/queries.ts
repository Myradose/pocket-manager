import { useMutation, useQueryClient } from "@tanstack/react-query";
import { honoClient } from "../../lib/api/client";

export type TskTask = {
  id: string;
  name: string;
  status: string;
  repo_root: string;
  project: string;
  branch_name: string;
  created_at: string;
  started_at: string | null;
  container_id?: string;
  transcripts_dir: string;
  frontend_url?: string;
  vnc_url?: string;
};

export const tskTasksQuery = {
  queryKey: ["tsk", "tasks"],
  queryFn: async (): Promise<TskTask[]> => {
    const response = await honoClient.api.tsk.tasks.$get();
    if (!response.ok) {
      throw new Error(`Failed to fetch TSK tasks: ${response.statusText}`);
    }
    return await response.json();
  },
  refetchInterval: 5000, // Refresh every 5 seconds
} as const;

export const tskTranscriptQuery = (taskId: string) => ({
  queryKey: ["tsk", "transcript", taskId],
  queryFn: async () => {
    const response = await honoClient.api.tsk.tasks[":taskId"].transcript.$get({
      param: { taskId },
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch transcript: ${response.statusText}`);
    }
    return await response.json();
  },
  refetchInterval: 2000, // Refresh every 2 seconds for live updates
});

export const useCreateTskTask = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: {
      repo_path: string;
      name?: string;
      task_type?: string;
      agent?: string;
      stack?: string;
      serve?: boolean;
    }) => {
      const response = await honoClient.api.tsk.tasks.$post({
        json: request,
      });
      if (!response.ok) {
        throw new Error(`Failed to create task: ${response.statusText}`);
      }
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tsk", "tasks"] });
    },
  });
};

export const useDeleteTskTask = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (taskId: string) => {
      const response = await honoClient.api.tsk.tasks[":taskId"].$delete({
        param: { taskId },
      });
      if (!response.ok) {
        throw new Error(`Failed to delete task: ${response.statusText}`);
      }
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tsk", "tasks"] });
    },
  });
};

export const useStopTskTask = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (taskId: string) => {
      const response = await honoClient.api.tsk.tasks[":taskId"].stop.$post({
        param: { taskId },
      });
      if (!response.ok) {
        throw new Error(`Failed to stop task: ${response.statusText}`);
      }
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tsk", "tasks"] });
    },
  });
};
