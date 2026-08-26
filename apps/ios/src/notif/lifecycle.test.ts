import { describe, expect, test } from "bun:test";
import {
  _resetPushLifecycle,
  cancelPushOperationsAndWait,
  runPushOperation,
  runPushRevocation,
} from "./lifecycle";

describe("push lifecycle coordinator", () => {
  test("cancels an in-flight registration before the next account operation", async () => {
    _resetPushLifecycle();
    let release!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let firstAborted = false;
    const first = runPushOperation(async ({ signal }) => {
      started();
      await blocked;
      firstAborted = signal.aborted;
    });
    await startedPromise;
    const cancelling = cancelPushOperationsAndWait();
    release();
    await Promise.all([first, cancelling]);
    expect(firstAborted).toBe(true);

    let secondRan = false;
    await runPushOperation(async () => {
      secondRan = true;
    });
    expect(secondRan).toBe(true);
  });

  test("serializes overlapping account revocations", async () => {
    _resetPushLifecycle();
    const order: string[] = [];
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = runPushRevocation(async () => {
      order.push("first-start");
      await blocked;
      order.push("first-end");
    });
    const second = runPushRevocation(async () => {
      order.push("second");
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second"]);
  });
});
