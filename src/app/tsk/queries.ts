import { useMutation, useQueryClient } from "@tanstack/react-query";
import { honoClient } from "../../lib/api/client";

export type ServiceInfo = {
  key: string;
  url: string;
  port: number;
  path: string;
};

export type ServiceDisplayConfig = {
  label: string;
  icon: string;
  visible: boolean;
  order: number;
  embedType: "iframe" | "vnc";
};

export type TskTask = {
  id: string;
  name: string;
  name_source?: string;
  status: string;
  repo_root: string;
  project: string;
  branch_name: string;
  created_at: string;
  started_at: string | null;
  container_id?: string;
  transcripts_dir: string;
  services: ServiceInfo[];
  copied_repo_path?: string;
  submodules?: string[];
};

export const tskTasksQuery = (repo?: string) => ({
  queryKey: ["tsk", "tasks", repo ?? "all"],
  queryFn: async (): Promise<TskTask[]> => {
    const response = await honoClient.api.tsk.tasks.$get(
      repo ? { query: { repo } } : {},
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch TSK tasks: ${response.statusText}`);
    }
    return await response.json();
  },
  refetchInterval: 5000, // Refresh every 5 seconds
});

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

export const useOpenPath = () =>
  useMutation({
    mutationFn: async (params: {
      path: string;
      target: "explorer" | "vscode";
    }) => {
      const response = await honoClient.api.tsk.open.$post({
        json: params,
      });
      if (!response.ok) {
        throw new Error(`Failed to open path: ${response.statusText}`);
      }
      return await response.json();
    },
  });

export const useContinueTskTask = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (taskId: string) => {
      const response = await honoClient.api.tsk.tasks[":taskId"].continue.$post(
        {
          param: { taskId },
        },
      );
      if (!response.ok) {
        throw new Error(`Failed to continue task: ${response.statusText}`);
      }
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tsk", "tasks"] });
    },
  });
};

export const useRenameTskTask = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { taskId: string; name: string }) => {
      const response = await honoClient.api.tsk.tasks[":taskId"].rename.$patch({
        param: { taskId: params.taskId },
        json: { name: params.name },
      });
      if (!response.ok) {
        throw new Error(`Failed to rename task: ${response.statusText}`);
      }
      return await response.json();
    },
    onMutate: async (params) => {
      // Cancel outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: ["tsk", "tasks"] });
      // Optimistically update all task query caches
      queryClient.setQueriesData<TskTask[]>(
        { queryKey: ["tsk", "tasks"] },
        (old) =>
          old?.map((t) =>
            t.id === params.taskId
              ? { ...t, name: params.name, name_source: "user" }
              : t,
          ),
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["tsk", "tasks"] });
    },
  });
};

export const useSuggestTskTaskName = () =>
  useMutation({
    mutationFn: async (taskId: string) => {
      const response = await honoClient.api.tsk.tasks[":taskId"][
        "suggest-name"
      ].$post({
        param: { taskId },
      });
      if (!response.ok) {
        throw new Error(`Failed to suggest name: ${response.statusText}`);
      }
      return (await response.json()) as { name: string | null };
    },
  });

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

export const tskServiceDisplayConfigQuery = (projectPath: string) => ({
  queryKey: ["tsk", "service-config", projectPath],
  queryFn: async (): Promise<Record<string, ServiceDisplayConfig> | null> => {
    const response = await honoClient.api.tsk["service-config"].$get({
      query: { projectPath },
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch service config: ${response.statusText}`);
    }
    const data = (await response.json()) as {
      services: Record<string, ServiceDisplayConfig> | null;
    };
    return data.services;
  },
  staleTime: 30000,
});

export const useUpdateServiceDisplayConfig = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      projectPath: string;
      services: Record<string, ServiceDisplayConfig>;
    }) => {
      const response = await honoClient.api.tsk["service-config"].$put({
        json: params,
      });
      if (!response.ok) {
        throw new Error(
          `Failed to update service config: ${response.statusText}`,
        );
      }
      return await response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["tsk", "service-config", variables.projectPath],
      });
    },
  });
};
