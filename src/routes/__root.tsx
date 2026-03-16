import { createRootRoute, Outlet } from "@tanstack/react-router";
import { RootErrorBoundary } from "../app/components/RootErrorBoundary";
import { ThemeProvider } from "../components/ThemeProvider";
import { Toaster } from "../components/ui/sonner";

export const Route = createRootRoute({
  component: () => (
    <RootErrorBoundary>
      <ThemeProvider>
        <Outlet />
      </ThemeProvider>
      <Toaster position="top-right" />
    </RootErrorBoundary>
  ),
});
