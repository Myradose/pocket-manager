import { z } from "zod";

export const ensureTerminalSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9_-]+$/),
  cols: z.number().int().min(1).optional(),
  rows: z.number().int().min(1).optional(),
});

export type EnsureTerminalRequest = z.infer<typeof ensureTerminalSchema>;
