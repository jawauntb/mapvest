import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_PREFIX = "mapvest.researchConversation.v1";

function storageKey(scope: string, ownerId?: string): string {
  return `${STORAGE_PREFIX}:${encodeURIComponent(ownerId ?? "anonymous")}:${encodeURIComponent(scope)}`;
}

export async function loadResearchConversationId(
  scope: string,
  ownerId?: string,
): Promise<string | undefined> {
  try {
    return (await AsyncStorage.getItem(storageKey(scope, ownerId)))?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function saveResearchConversationId(
  scope: string,
  conversationId: string,
  ownerId?: string,
): Promise<void> {
  try {
    await AsyncStorage.setItem(storageKey(scope, ownerId), conversationId);
  } catch {
    /* Persistence is best-effort; the in-memory conversation remains usable. */
  }
}

export async function clearResearchConversationId(scope: string, ownerId?: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(storageKey(scope, ownerId));
  } catch {
    /* Starting a new in-memory conversation still works without persistence. */
  }
}
