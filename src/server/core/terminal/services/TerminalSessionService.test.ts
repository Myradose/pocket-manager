import { Effect } from "effect";
import { describe, expect, test } from "vitest";
import { TerminalSessionService } from "./TerminalSessionService";

const testLayer = TerminalSessionService.Live;

describe("TerminalSessionService", () => {
  test("getPtyAttachment returns null when no attachment exists", async () => {
    const service = await Effect.runPromise(
      TerminalSessionService.pipe(Effect.provide(testLayer)),
    );

    const attachment = await Effect.runPromise(
      service.getPtyAttachment("container1", "shell-1"),
    );

    expect(attachment).toBeNull();
  });

  test("cancelPtyCleanup does not throw for non-existent attachment", async () => {
    const service = await Effect.runPromise(
      TerminalSessionService.pipe(Effect.provide(testLayer)),
    );

    await Effect.runPromise(service.cancelPtyCleanup("container1", "shell-1"));
  });

  test("detachPty does not throw for non-existent attachment", async () => {
    const service = await Effect.runPromise(
      TerminalSessionService.pipe(Effect.provide(testLayer)),
    );

    await Effect.runPromise(service.detachPty("container1", "shell-1"));
  });
});
