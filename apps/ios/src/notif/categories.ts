import { PUSH_ACTION_IDS } from "./delivery";

export const PUSH_CATEGORY_IDS = {
  map: "mapvest-map-v1",
  company: "mapvest-company-v1",
  settings: "mapvest-settings-v1",
} as const;

export type PushCategoryDefinition = {
  identifier: string;
  actions: Array<{
    identifier: string;
    buttonTitle: string;
    options: { opensAppToForeground: true };
  }>;
};

const settingsAction = {
  identifier: PUSH_ACTION_IDS.settings,
  buttonTitle: "Notification Settings",
  options: { opensAppToForeground: true as const },
};

export const PUSH_CATEGORY_DEFINITIONS: PushCategoryDefinition[] = [
  {
    identifier: PUSH_CATEGORY_IDS.map,
    actions: [
      {
        identifier: PUSH_ACTION_IDS.viewMap,
        buttonTitle: "View on Map",
        options: { opensAppToForeground: true },
      },
      {
        identifier: PUSH_ACTION_IDS.viewCompany,
        buttonTitle: "View Company",
        options: { opensAppToForeground: true },
      },
      settingsAction,
    ],
  },
  {
    identifier: PUSH_CATEGORY_IDS.company,
    actions: [
      {
        identifier: PUSH_ACTION_IDS.viewCompany,
        buttonTitle: "View Company",
        options: { opensAppToForeground: true },
      },
      settingsAction,
    ],
  },
  { identifier: PUSH_CATEGORY_IDS.settings, actions: [settingsAction] },
];
