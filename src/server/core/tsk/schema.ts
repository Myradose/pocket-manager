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

export type TskTaskResponse = {
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
  copied_repo_path?: string;
};
