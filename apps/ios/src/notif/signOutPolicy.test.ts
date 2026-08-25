import { describe, expect, test } from "bun:test";

import {
  type PushSignOutDependencies,
  PushSignOutRevocationError,
  revokePushForSignOut,
} from "./signOutPolicy";

function fixture(
  overrides: Partial<PushSignOutDependencies> = {},
): PushSignOutDependencies & { calls: string[] } {
  const calls: string[] = [];
  return {
    tokenId: "push_server_id",
    tokenStorageReadable: true,
    unlinkServer: async () => {
      calls.push("server");
    },
    unregisterNative: async () => {
      calls.push("native");
    },
    dismissNative: async () => {
      calls.push("dismiss");
    },
    clearStoredTokenId: async () => {
      calls.push("clear");
    },
    calls,
    ...overrides,
  };
}

describe("push sign-out privacy policy", () => {
  test("clears the stored id after the server removes this installation", async () => {
    const deps = fixture();
    deps.unregisterNative = async () => {
      deps.calls.push("native");
      throw new Error("native offline");
    };

    await expect(revokePushForSignOut(deps)).resolves.toEqual({
      serverUnlinked: true,
      nativeUnregistered: false,
    });
    expect(deps.calls).toEqual(["server", "native", "dismiss", "clear"]);
  });

  test("clears the stored id when native Expo unregistration succeeds after server failure", async () => {
    const deps = fixture();
    deps.unlinkServer = async () => {
      deps.calls.push("server");
      throw new Error("server offline");
    };

    await expect(revokePushForSignOut(deps)).resolves.toEqual({
      serverUnlinked: false,
      nativeUnregistered: true,
    });
    expect(deps.calls).toEqual(["server", "native", "dismiss", "clear"]);
  });

  test("a confirmed no-token sign-out succeeds even if native cleanup is unavailable", async () => {
    const deps = fixture({ tokenId: null, tokenStorageReadable: true });
    deps.unregisterNative = async () => {
      deps.calls.push("native");
      throw new Error("unsupported platform");
    };

    await expect(revokePushForSignOut(deps)).resolves.toEqual({
      serverUnlinked: false,
      nativeUnregistered: false,
    });
    expect(deps.calls).toEqual(["native", "dismiss", "clear"]);
  });

  test("keeps the authenticated session retryable when every revocation path fails", async () => {
    const deps = fixture();
    deps.unlinkServer = async () => {
      deps.calls.push("server");
      throw new Error("server offline");
    };
    deps.unregisterNative = async () => {
      deps.calls.push("native");
      throw new Error("native unavailable");
    };

    await expect(revokePushForSignOut(deps)).rejects.toBeInstanceOf(PushSignOutRevocationError);
    expect(deps.calls).toEqual(["server", "native", "dismiss"]);
  });
});
