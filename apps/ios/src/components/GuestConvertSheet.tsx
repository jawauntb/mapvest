import {
  GUEST_PROMPT_EVENT,
  type GuestPromptEvent,
  noteGuestForeground,
} from "@/auth/guestConvert";
import { guestPromptCopy } from "@/auth/guestPromptPolicy";
import { hasSeenFirstOpen, markGuestPromptShown } from "@/auth/guestPromptStorage";
import { useSession } from "@/auth/session";
import { PrimaryButton } from "@/components/PrimaryButton";
import { colors, elevation, radii, type } from "@/theme/tokens";
import { hapticSelect } from "@/util/haptics";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  AppState,
  type AppStateStatus,
  DeviceEventEmitter,
  Modal,
  Pressable,
  StyleSheet,
  Text,
} from "react-native";

/**
 * Non-blocking convert sheet. First-open keeps the cold-boot slot; this
 * sheet only appears after that ritual, never for signed-in users.
 */
export function GuestConvertSheet() {
  const router = useRouter();
  const { session } = useSession();
  const signedIn = Boolean(session?.token);
  const [prompt, setPrompt] = useState<GuestPromptEvent | null>(null);

  useEffect(() => {
    if (signedIn) {
      setPrompt(null);
      return;
    }

    const show = (event: GuestPromptEvent) => {
      void (async () => {
        if (!(await hasSeenFirstOpen())) return;
        let presented = false;
        setPrompt((current) => {
          if (current) return current;
          presented = true;
          return event;
        });
        if (presented) await markGuestPromptShown(event.moment);
      })();
    };

    const sub = DeviceEventEmitter.addListener(GUEST_PROMPT_EVENT, (event: GuestPromptEvent) => {
      if (!event?.moment) return;
      show(event);
    });

    let appState: AppStateStatus = AppState.currentState;
    let sawBackground = false;
    const appSub = AppState.addEventListener("change", (next) => {
      const prev = appState;
      appState = next;
      if (next !== "active" && next !== "inactive") sawBackground = true;
      if (next === "active" && prev !== "active" && sawBackground) {
        void noteGuestForeground({ signedIn: false });
      }
    });

    // First-open owns a brand-new install. A returning guest after ≥3 days
    // can see backgrounded_return on this launch.
    void noteGuestForeground({ signedIn: false });

    return () => {
      sub.remove();
      appSub.remove();
    };
  }, [signedIn]);

  function dismiss() {
    hapticSelect();
    setPrompt(null);
  }

  if (signedIn || !prompt) return null;

  const copy = guestPromptCopy(prompt.moment, prompt.rarity ?? null);

  return (
    <Modal visible animationType="fade" transparent onRequestClose={dismiss}>
      <Pressable style={styles.scrim} onPress={dismiss} accessibilityLabel="Dismiss sign-in prompt">
        <Pressable
          style={[styles.card, elevation.lg]}
          onPress={(event) => event.stopPropagation()}
          accessibilityViewIsModal
        >
          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.body}>{copy.body}</Text>
          <PrimaryButton
            label="Sign in"
            onPress={() => {
              hapticSelect();
              setPrompt(null);
              router.push("/auth");
            }}
            accessibilityLabel="Sign in"
            style={{ alignSelf: "stretch" }}
          />
          <Pressable
            onPress={dismiss}
            style={styles.secondary}
            accessibilityRole="button"
            accessibilityLabel="Not yet"
          >
            <Text style={styles.secondaryText}>Not yet</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: colors.bgElevated,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 22,
    gap: 14,
  },
  title: { color: colors.fg, ...type.h2, fontSize: 22 },
  body: { color: colors.fgMuted, ...type.body, fontSize: 15, lineHeight: 22 },
  secondary: {
    alignItems: "center",
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: "center",
  },
  secondaryText: { color: colors.fgMuted, fontSize: 15, fontWeight: "700" },
});
