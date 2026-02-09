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
