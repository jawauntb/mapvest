import { describe, expect, test } from "bun:test";

type AppConfig = {
  expo: {
    ios: {
      associatedDomains?: string[];
      entitlements?: Record<string, unknown>;
    };
    plugins?: Array<string | [string, Record<string, unknown>]>;
  };
};

type EasConfig = {
  build: Record<
    string,
    {
      extends?: string;
      autoIncrement?: boolean;
      ios?: {
        image?: string;
      };
    }
  >;
};

async function readJson<T>(path: string): Promise<T> {
  return (await Bun.file(new URL(path, import.meta.url)).json()) as T;
}

describe("production signing configuration", () => {
  test("keeps universal links and the widget app group in the signing contract", async () => {
    const config = await readJson<AppConfig>("../../app.json");

    expect(config.expo.ios.associatedDomains).toEqual([
      "applinks:mapvest.app",
      "applinks:www.mapvest.app",
    ]);
    expect(config.expo.ios.entitlements?.["com.apple.security.application-groups"]).toEqual([
      "group.com.mapvest.app.widget",
    ]);
    expect(config.expo.ios.entitlements?.["com.apple.developer.associated-domains"]).toEqual(
      config.expo.ios.associatedDomains,
    );

    const shareIntentPlugin = config.expo.plugins?.find(
      (plugin): plugin is [string, Record<string, unknown>] =>
        Array.isArray(plugin) && plugin[0] === "expo-share-intent",
    );
    expect(shareIntentPlugin?.[1].iosAppGroupIdentifier).toBe("group.com.mapvest.app.widget");
  });

  test("uses production credentials without incrementing during preflight", async () => {
    const config = await readJson<EasConfig>("../../eas.json");

    expect(config.build["production-preflight"]).toEqual({
      extends: "production",
      autoIncrement: false,
    });
    expect(config.build.production?.autoIncrement).toBe(true);
    expect(config.build.production?.ios?.image).toBe("macos-sequoia-15.6-xcode-26.0");
  });
});
