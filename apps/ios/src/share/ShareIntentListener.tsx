import { useRouter } from "expo-router";
import { useShareIntentContext } from "expo-share-intent";
import { useEffect, useRef } from "react";

/**
 * Mounted once at the root of the app (see `app/_layout.tsx`). Sits inside
 * `ShareIntentProvider` and just watches for the OS handing Mapvest a share
 * (image/text/url from Photos, Safari, Messages, ChatGPT, Claude, Google
 * Photos, …) and routes to `/share-intent` to process it — the same "Open
 * in…" pattern those apps show for a photo, but landing in Mapvest.
 *
 * Renders nothing; all the actual handling lives in `app/share-intent.tsx`,
 * which reads the same `useShareIntentContext()` value once it's mounted.
 */
export function ShareIntentListener() {
  const { hasShareIntent } = useShareIntentContext();
  const router = useRouter();
  const navigated = useRef(false);

  useEffect(() => {
    if (hasShareIntent && !navigated.current) {
      navigated.current = true;
      router.push("/share-intent");
    } else if (!hasShareIntent) {
      navigated.current = false;
    }
  }, [hasShareIntent, router]);

  return null;
}
