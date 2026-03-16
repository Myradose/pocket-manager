import { FileSystem, Path } from "@effect/platform";
import { Context, Effect, Layer, Ref, Runtime } from "effect";
import { claudeCodeViewerCacheDirPath } from "../../../lib/config/paths";
import type { InferEffect } from "../../../lib/effect/types";
import {
  projectServiceConfigSchema,
  type ServiceDisplayConfig,
} from "../schema";

const CACHE_FILE = "tsk-service-display-config.json";

type StoredConfigs = Record<
  string,
  { projectPath: string; services: Record<string, ServiceDisplayConfig> }
>;

const LayerImpl = Effect.gen(function* () {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const runtime = yield* Effect.runtime<FileSystem.FileSystem>();

  const cacheFilePath = path.resolve(claudeCodeViewerCacheDirPath, CACHE_FILE);

  const emptyConfigs: StoredConfigs = {};

  // Load initial state from disk
  const initialData = yield* Effect.gen(function* () {
    if (!(yield* fs.exists(claudeCodeViewerCacheDirPath))) {
      yield* fs.makeDirectory(claudeCodeViewerCacheDirPath, {
        recursive: true,
      });
    }
    if (!(yield* fs.exists(cacheFilePath))) {
      return emptyConfigs;
    }
    const content = yield* fs.readFileString(cacheFilePath);
    try {
      const parsed = JSON.parse(content);
      // Validate each entry
      const result: StoredConfigs = {};
      for (const [key, value] of Object.entries(
        parsed as Record<string, unknown>,
      )) {
        const validated = projectServiceConfigSchema.safeParse(value);
        if (validated.success) {
          result[key] = validated.data;
        }
      }
      return result;
    } catch {
      return emptyConfigs;
    }
  }).pipe(Effect.catchAll(() => Effect.succeed(emptyConfigs)));

  const storeRef = yield* Ref.make(initialData);

  const syncToFile = (data: StoredConfigs) => {
    Runtime.runFork(runtime)(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString(cacheFilePath, JSON.stringify(data));
      }),
    );
  };

  const getConfig = (projectPath: string) =>
    Effect.gen(function* () {
      const store = yield* Ref.get(storeRef);
      const entry = store[projectPath];
      return entry?.services ?? null;
    });

  const saveConfig = (
    projectPath: string,
    services: Record<string, ServiceDisplayConfig>,
  ) =>
    Effect.gen(function* () {
      yield* Ref.update(storeRef, (store) => ({
        ...store,
        [projectPath]: { projectPath, services },
      }));
      const updated = yield* Ref.get(storeRef);
      syncToFile(updated);
    });

  return {
    getConfig,
    saveConfig,
  };
});

export type IServiceDisplayConfigService = InferEffect<typeof LayerImpl>;
export class ServiceDisplayConfigService extends Context.Tag(
  "ServiceDisplayConfigService",
)<ServiceDisplayConfigService, IServiceDisplayConfigService>() {
  static Live = Layer.effect(this, LayerImpl);
}
