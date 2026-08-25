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

  test("disables Expo auto-registration but never counts it as revocation", async () => {
    const deps = fixture();
    deps.disableAutoRegistration = async () => {
      deps.calls.push("disable-auto");
    };

    await expect(revokePushForSignOut(deps)).resolves.toMatchObject({ serverUnlinked: true });
    expect(deps.calls).toEqual(["server", "disable-auto", "native", "dismiss", "clear"]);
  });

  test("does not treat native Expo unregistration as server revocation", async () => {
    const deps = fixture();
    deps.unlinkServer = async () => {
      deps.calls.push("server");
      throw new Error("server offline");
    };

    await expect(revokePushForSignOut(deps)).rejects.toBeInstanceOf(PushSignOutRevocationError);
    expect(deps.calls).toEqual(["server", "native", "dismiss"]);
  });

  test("uses identity fallback when the stored token id is missing", async () => {
    const deps = fixture({ tokenId: null, tokenStorageReadable: true });
    deps.unlinkServer = undefined;
    deps.unlinkServerByIdentity = async () => {
      deps.calls.push("identity");
    };

    await expect(revokePushForSignOut(deps)).resolves.toEqual({
      serverUnlinked: true,
      nativeUnregistered: true,
    });
    expect(deps.calls).toEqual(["identity", "native", "dismiss", "clear"]);
  });

  test("falls back to physical identity after an expired bearer returns 401", async () => {
    const deps = fixture();
    deps.unlinkServer = async () => {
      deps.calls.push("server");
      throw new Error("401");
    };
    deps.unlinkServerByIdentity = async () => {
      deps.calls.push("identity");
    };

    await expect(revokePushForSignOut(deps)).resolves.toMatchObject({
      serverUnlinked: true,
      nativeUnregistered: true,
    });
    expect(deps.calls).toEqual(["server", "identity", "native", "dismiss", "clear"]);
  });

  test("falls back to claimant identity after an authenticated stale-id 404", async () => {
    const deps = fixture();
    deps.unlinkServer = async () => {
      deps.calls.push("server");
      throw new Error("404 token not found");
    };
    deps.unlinkServerByIdentity = async () => {
      deps.calls.push("identity");
    };

    await expect(revokePushForSignOut(deps)).resolves.toMatchObject({ serverUnlinked: true });
    expect(deps.calls).toEqual(["server", "identity", "native", "dismiss", "clear"]);
  });

  test("fails closed when SecureStore times out and identity revocation hangs", async () => {
    const deps = fixture({ tokenId: null, tokenStorageReadable: false });
    deps.unlinkServer = undefined;
    deps.unlinkServerByIdentity = () => new Promise<void>(() => undefined);

    await expect(revokePushForSignOut(deps)).rejects.toBeInstanceOf(PushSignOutRevocationError);
    expect(deps.calls).toEqual(["native", "dismiss"]);
  });

  test("a confirmed no-token sign-out succeeds even if native cleanup is unavailable", async () => {
    const deps = fixture({
      tokenId: null,
      tokenStorageReadable: true,
      physicalIdentityStatus: "confirmed-none",
    });
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

  test("expired cleanup cannot complete from native unregister when a claim may exist", async () => {
    const deps = fixture({
      tokenId: null,
      tokenStorageReadable: false,
      mayBeRegistered: true,
      unlinkServer: undefined,
      unlinkServerByIdentity: undefined,
    });

    await expect(revokePushForSignOut(deps)).rejects.toBeInstanceOf(PushSignOutRevocationError);
    expect(deps.calls).toEqual(["native", "dismiss"]);
  });

  test("may-be-registered evidence fails closed when native unregister fails", async () => {
    const deps = fixture({
      tokenId: null,
      tokenStorageReadable: true,
      mayBeRegistered: true,
      unlinkServer: undefined,
      unlinkServerByIdentity: undefined,
    });
    deps.unregisterNative = async () => {
      deps.calls.push("native");
      throw new Error("native unavailable");
    };

    await expect(revokePushForSignOut(deps)).rejects.toBeInstanceOf(PushSignOutRevocationError);
    expect(deps.calls).toEqual(["native", "dismiss"]);
  });

  test("a readable null id plus transient identity failure still fails closed", async () => {
    const deps = fixture({
      tokenId: null,
      tokenStorageReadable: true,
      registrationEvidenceReadable: true,
      mayBeRegistered: false,
      physicalIdentityStatus: "unavailable",
      unlinkServer: undefined,
      unlinkServerByIdentity: undefined,
    });
    deps.unregisterNative = async () => {
      deps.calls.push("native");
      throw new Error("native unavailable");
    };

    await expect(revokePushForSignOut(deps)).rejects.toBeInstanceOf(PushSignOutRevocationError);
    expect(deps.calls).toEqual(["native", "dismiss"]);
  });

  test("unknown identity does not clear cleanup even when native unregister succeeds", async () => {
    const deps = fixture({
      tokenId: null,
      tokenStorageReadable: true,
      registrationEvidenceReadable: true,
      mayBeRegistered: false,
      physicalIdentityStatus: "unavailable",
      unlinkServer: undefined,
      unlinkServerByIdentity: undefined,
    });

    await expect(revokePushForSignOut(deps)).rejects.toBeInstanceOf(PushSignOutRevocationError);
    expect(deps.calls).toEqual(["native", "dismiss"]);
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
