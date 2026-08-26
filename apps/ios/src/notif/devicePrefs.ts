/**
 * Preference reads are deliberately tied to this install's stored push-token
 * id. Falling back to the account's newest token would expose another device's
 * settings and let one device change another one's delivery preferences.
 */
export type DevicePushPrefs<Prefs> = {
  prefs: Prefs;
  tokenId: string | null;
};

export type DevicePushPrefsDependencies<Session, Prefs> = {
  readStoredTokenId: () => Promise<string | null>;
  readPushPrefs: (session: Session, tokenId: string) => Promise<DevicePushPrefs<Prefs>>;
};

/** Returns null when this install has no current server-side push token. */
export async function getStoredDevicePushPrefs<Session, Prefs>(
  session: Session,
  dependencies: DevicePushPrefsDependencies<Session, Prefs>,
): Promise<DevicePushPrefs<Prefs> | null> {
  const storedTokenId = await dependencies.readStoredTokenId();
  if (!storedTokenId) return null;
  return dependencies.readPushPrefs(session, storedTokenId);
}
