import type { WidgetTaskHandlerProps } from "react-native-android-widget";
import { NearbyWidget } from "./NearbyWidget";
import { fetchWidgetNearby } from "./widgetData";

/** Must match the `name` in the `react-native-android-widget` app.json plugin config. */
export const WIDGET_NAME = "NearbyWidget";

/**
 * Registered from `index.js` (see there for why it can't live under
 * expo-router). Handles the Android home-screen widget lifecycle: fetch
 * fresh nearby data and re-render on add/update/resize, no-op on delete.
 */
export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  if (props.widgetInfo.widgetName !== WIDGET_NAME) return;

  switch (props.widgetAction) {
    case "WIDGET_ADDED":
    case "WIDGET_UPDATE":
    case "WIDGET_RESIZED": {
      const data = await fetchWidgetNearby();
      props.renderWidget(<NearbyWidget {...data} />);
      break;
    }
    default:
      break;
  }
}
