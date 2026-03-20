import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { TskDashboard } from "../app/tsk/TskDashboard";

const tskSearchSchema = z.object({
  tasks: z.string().optional(), // Comma-separated task IDs
});

export const Route = createFileRoute("/")({
  validateSearch: tskSearchSchema,
  component: RouteComponent,
});

function RouteComponent() {
  const search = Route.useSearch();
  const taskIds = search.tasks?.split(",").filter(Boolean) ?? [];

  return (
    <>
      <title>Pocket Dashboard</title>
      <TskDashboard taskIds={taskIds} />
    </>
  );
}
