import { z } from "zod";

export const createTerminalRequestSchema = z.object({
  taskId: z.string().min(1),
  cols: z.number().int().min(1).optional(),
  rows: z.number().int().min(1).optional(),
  label: z.string().optional(),
});

export type CreateTerminalRequest = z.infer<typeof createTerminalRequestSchema>;

export type TerminalSessionResponse = {
  id: string;
  taskId: string;
  containerId: string;
  createdAt: string;
};
