import { honoClient } from "./client";

export const configQuery = {
  queryKey: ["config"],
  queryFn: async () => {
    const response = await honoClient.api.config.$get();

    if (!response.ok) {
      throw new Error(`Failed to fetch config: ${response.statusText}`);
    }

    return await response.json();
  },
} as const;
