import { z } from "zod";

export const createTaskRequestSchema = z.object({
  name: z.string().optional(),
  repo_path: z.string().min(1),
  task_type: z.string().optional(),
  agent: z.string().optional(),
  stack: z.string().optional(),
  serve: z.boolean().optional(),
});

export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;

export type ServiceInfo = {
  key: string;
  url: string;
  port: number;
  path: string;
};

export type TskTaskResponse = {
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

export type ServiceDisplayConfig = {
  label: string;
  icon: string;
  visible: boolean;
  order: number;
  embedType: "iframe" | "vnc";
};

export const serviceDisplayConfigSchema = z.object({
  label: z.string(),
  icon: z.string(),
  visible: z.boolean(),
  order: z.number(),
  embedType: z.enum(["iframe", "vnc"]),
});

export type ProjectServiceConfig = {
  projectPath: string;
  services: Record<string, ServiceDisplayConfig>;
};

export const projectServiceConfigSchema = z.object({
  projectPath: z.string(),
  services: z.record(z.string(), serviceDisplayConfigSchema),
});
