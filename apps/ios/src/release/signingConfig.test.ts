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

const widgetInfoPlistUrl = new URL("../../targets/widget/Info.plist", import.meta.url);
const widgetPrivacyManifestUrl = new URL(
  "../../targets/widget/PrivacyInfo.xcprivacy",
  import.meta.url,
);
const productionWorkflowUrl = new URL(
  "../../../../.github/workflows/ios-eas-production.yml",
  import.meta.url,
);

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

  test("inherits native app version/build settings and declares widget privacy use", async () => {
    const infoPlist = await Bun.file(widgetInfoPlistUrl).text();
    const privacyManifest = await Bun.file(widgetPrivacyManifestUrl).text();

    expect(infoPlist).toContain("$(MARKETING_VERSION)");
    expect(infoPlist).toContain("$(CURRENT_PROJECT_VERSION)");
    expect(infoPlist).not.toMatch(/<string>(?:0\.1\.0|98|99)<\/string>/);
    expect(privacyManifest).toContain("NSPrivacyAccessedAPICategoryUserDefaults");
    expect(privacyManifest).toContain("CA92.1");
    expect(privacyManifest).not.toContain("bearer");
    expect(privacyManifest).not.toContain("provider key");
  });

  test("inspects the signed archive before the cloud candidate build", async () => {
    const workflow = await Bun.file(productionWorkflowUrl).text();

    expect(workflow).toContain("CFBundleShortVersionString");
    expect(workflow).toContain("CFBundleVersion");
    expect(workflow).toContain("codesign -d --entitlements");
    expect(workflow).toContain("group.com.mapvest.app.widget");
    expect(workflow).toContain("PrivacyInfo.xcprivacy");
    expect(workflow).toContain("OPENROUTER_API_KEY|EXA_API_KEY|MASSIVE_API_KEY");
  });
});
