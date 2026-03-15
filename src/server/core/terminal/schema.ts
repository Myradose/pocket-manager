import { z } from "zod";

export const createTerminalRequestSchema = z.object({
  taskId: z.string().min(1),
});

export type CreateTerminalRequest = z.infer<typeof createTerminalRequestSchema>;

export type TerminalSessionResponse = {
  id: string;
  taskId: string;
  containerId: string;
  createdAt: string;
};
