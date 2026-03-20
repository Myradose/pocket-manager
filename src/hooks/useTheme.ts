type ResolvedTheme = "light" | "dark";

export const useTheme = () => {
  const resolvedTheme: ResolvedTheme = "dark";

  return {
    theme: "dark" as const,
    resolvedTheme,
  };
};
