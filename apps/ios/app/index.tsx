import { useSession } from "@/auth/session";
import { Redirect } from "expo-router";

export default function Gate() {
  const { ready, session } = useSession();
  // Session hydrate is capped at 800ms. Never block a cold install forever
  // (that looked like the TestFlight black screen on Brian's phone).
  if (!ready) return <Redirect href="/(tabs)/home" />;
  return <Redirect href={session ? "/(tabs)/map" : "/(tabs)/home"} />;
}
