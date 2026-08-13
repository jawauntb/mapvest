// Custom entry point (replaces the default "expo-router/entry" `main`).
//
// react-native-android-widget needs a headless task registered before the
// app registers its main component, and that registration has to live
// outside of expo-router's file-based routes. `expo-router/entry` still
// does the actual app bootstrapping — this file just adds the widget task
// registration alongside it. iOS's WidgetKit extension doesn't need
// anything from this file: it's a fully separate native target that never
// runs the RN/JS bundle (see targets/widget/).
import "expo-router/entry";

import { registerWidgetTaskHandler } from "react-native-android-widget";
import { widgetTaskHandler } from "./src/widgets/widget-task-handler";

registerWidgetTaskHandler(widgetTaskHandler);
