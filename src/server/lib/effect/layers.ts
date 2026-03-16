import { NodeContext } from "@effect/platform-node";
import { Layer } from "effect";
import { CcvOptionsService } from "../../core/platform/services/CcvOptionsService";
import { EnvService } from "../../core/platform/services/EnvService";
import { UserConfigService } from "../../core/platform/services/UserConfigService";

export const platformLayer = Layer.mergeAll(
  UserConfigService.Live,
  EnvService.Live,
  CcvOptionsService.Live,
).pipe(
  Layer.provide(EnvService.Live),
  Layer.provide(CcvOptionsService.Live),
  Layer.provide(NodeContext.layer),
);
