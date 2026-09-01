import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  type NotificationData,
  type PushDeliveryAdmissionReason,
  type PushDeliveryLedgerEntry,
  type PushNotificationDelivery,
  parsePushNotificationDelivery,
  prunePushDeliveryEntries,
  pushDeliveryAdmissionReason,
} from "./delivery";

const PUSH_DELIVERY_LEDGER_KEY = "mapvest.pushDeliveryLedger.v1";

export type PushDeliveryScope = { accountId: string; installationId: string };

type PushDeliveryLedger = {
  schemaVersion: 1;
  scope: PushDeliveryScope;
  entries: Record<string, PushDeliveryLedgerEntry>;
};

export type PushDeliveryStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

function sameScope(left: PushDeliveryScope, right: PushDeliveryScope): boolean {
  return left.accountId === right.accountId && left.installationId === right.installationId;
}

function emptyLedger(scope: PushDeliveryScope): PushDeliveryLedger {
  return { schemaVersion: 1, scope, entries: {} };
}

function parseLedger(raw: string | null): PushDeliveryLedger | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PushDeliveryLedger>;
    if (
      value.schemaVersion !== 1 ||
      !value.scope ||
      typeof value.scope.accountId !== "string" ||
      typeof value.scope.installationId !== "string" ||
      !value.entries ||
      typeof value.entries !== "object" ||
      Array.isArray(value.entries)
    ) {
      return null;
    }
    const entries: Record<string, PushDeliveryLedgerEntry> = {};
    for (const [id, candidate] of Object.entries(value.entries)) {
      if (!candidate || typeof candidate !== "object") return null;
      const entry = candidate as PushDeliveryLedgerEntry;
      const delivery = parsePushNotificationDelivery({ mapvest: entry.delivery });
      if (
        !delivery ||
        delivery.deliveryId !== id ||
        (entry.status !== "pending" && entry.status !== "handled") ||
        !Number.isFinite(Date.parse(entry.admittedAt)) ||
        (entry.handledAt !== undefined && !Number.isFinite(Date.parse(entry.handledAt)))
      ) {
        return null;
      }
      entries[id] = { ...entry, delivery };
    }
    return { schemaVersion: 1, scope: value.scope, entries };
  } catch {
    return null;
  }
}

export function createPushDeliveryStore(storage: PushDeliveryStorage) {
  let queue: Promise<void> = Promise.resolve();
  const serialized = <T>(operation: () => Promise<T>): Promise<T> => {
    const run = queue.then(operation, operation);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const write = (ledger: PushDeliveryLedger) =>
    storage.setItem(PUSH_DELIVERY_LEDGER_KEY, JSON.stringify(ledger));

  return {
    activateScope(scope: PushDeliveryScope): Promise<void> {
      return serialized(async () => {
        const raw = await storage.getItem(PUSH_DELIVERY_LEDGER_KEY);
        const ledger = parseLedger(raw);
        if (raw && !ledger) {
          await write(emptyLedger(scope));
          throw new Error("Push delivery ledger was unavailable and has been reset");
        }
        if (!ledger || !sameScope(ledger.scope, scope)) await write(emptyLedger(scope));
      });
    },

    admit(
      data: NotificationData | null | undefined,
      scope: PushDeliveryScope & { claimOwnerAccountId: string },
      nowMs = Date.now(),
    ): Promise<
      | { accepted: true; delivery: PushNotificationDelivery }
      | { accepted: false; reason: PushDeliveryAdmissionReason | "unavailable" }
    > {
      const delivery = parsePushNotificationDelivery(data);
      return serialized(async () => {
        try {
          const raw = await storage.getItem(PUSH_DELIVERY_LEDGER_KEY);
          let ledger = parseLedger(raw);
          if (raw && !ledger) {
            await write(emptyLedger(scope));
            return { accepted: false, reason: "unavailable" } as const;
          }
          if (!ledger || !sameScope(ledger.scope, scope)) {
            ledger = emptyLedger(scope);
          }
          ledger.entries = prunePushDeliveryEntries(ledger.entries, nowMs);
          const reason = pushDeliveryAdmissionReason({
            delivery,
            installationId: scope.installationId,
            currentAccountId: scope.accountId,
            claimOwnerAccountId: scope.claimOwnerAccountId,
            entries: ledger.entries,
            nowMs,
          });
          if (reason !== "accepted" || !delivery) {
            await write(ledger);
            return { accepted: false, reason } as const;
          }
          ledger.entries[delivery.deliveryId] = {
            delivery,
            status: "pending",
            admittedAt: new Date(nowMs).toISOString(),
          };
          await write(ledger);
          return { accepted: true, delivery } as const;
        } catch {
          return { accepted: false, reason: "unavailable" } as const;
        }
      });
    },

    pending(scope: PushDeliveryScope, nowMs = Date.now()): Promise<PushNotificationDelivery[]> {
      return serialized(async () => {
        try {
          const ledger = parseLedger(await storage.getItem(PUSH_DELIVERY_LEDGER_KEY));
          if (!ledger || !sameScope(ledger.scope, scope)) return [];
          ledger.entries = prunePushDeliveryEntries(ledger.entries, nowMs);
          await write(ledger);
          return Object.values(ledger.entries)
            .filter((entry) => entry.status === "pending")
            .sort((a, b) => a.admittedAt.localeCompare(b.admittedAt))
            .map((entry) => entry.delivery);
        } catch {
          return [];
        }
      });
    },

    markHandled(
      deliveryId: string,
      scope: PushDeliveryScope,
      nowMs = Date.now(),
    ): Promise<boolean> {
      return serialized(async () => {
        try {
          const ledger = parseLedger(await storage.getItem(PUSH_DELIVERY_LEDGER_KEY));
          if (!ledger || !sameScope(ledger.scope, scope)) return false;
          const entry = ledger.entries[deliveryId];
          if (!entry) return false;
          ledger.entries[deliveryId] = {
            ...entry,
            status: "handled",
            handledAt: new Date(nowMs).toISOString(),
          };
          await write(ledger);
          return true;
        } catch {
          return false;
        }
      });
    },

    clear(): Promise<void> {
      return serialized(() => storage.removeItem(PUSH_DELIVERY_LEDGER_KEY));
    },
  };
}

export const pushDeliveryStore = createPushDeliveryStore(AsyncStorage);

export function clearPushDeliveryLedger(): Promise<void> {
  return pushDeliveryStore.clear();
}
