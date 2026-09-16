import AsyncStorage from "@react-native-async-storage/async-storage";
import type { QueryClient } from "@tanstack/react-query";
import { FIRST_FIND_FLAG_VALUE, FIRST_FIND_STORAGE_KEY, firstFindFlagQueryKey } from "./gate";

export { FIRST_FIND_FLAG_VALUE, FIRST_FIND_STORAGE_KEY, firstFindFlagQueryKey };

/** Fail-closed: a throw or missing key leaves the gate up. */
export async function readFirstFindFlag(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(FIRST_FIND_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Persist the guest unlock. Returns false when storage fails so the gate
 * stays up — never treat a failed write as success.
 */
export async function markFirstFind(queryClient?: QueryClient): Promise<boolean> {
  try {
    await AsyncStorage.setItem(FIRST_FIND_STORAGE_KEY, FIRST_FIND_FLAG_VALUE);
  } catch {
    return false;
  }
  queryClient?.setQueryData(firstFindFlagQueryKey, FIRST_FIND_FLAG_VALUE);
  return true;
}
