/**
 * Thin wrappers around expo-image-picker that request permissions up-front
 * and normalize the return to a `string | null` file URI. Both helpers
 * resolve to `null` on cancel/denied so call-sites can treat "no photo"
 * uniformly without inspecting the raw ImagePicker result shape.
 */

import * as ImagePicker from "expo-image-picker";

async function ensureLibraryPermission(): Promise<boolean> {
  const current = await ImagePicker.getMediaLibraryPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const req = await ImagePicker.requestMediaLibraryPermissionsAsync();
  return req.granted;
}

async function ensureCameraPermission(): Promise<boolean> {
  const current = await ImagePicker.getCameraPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const req = await ImagePicker.requestCameraPermissionsAsync();
  return req.granted;
}

/**
 * Prompt the user to pick a still image from their photo library.
 * Returns the local file:// URI on success, `null` if the user cancels
 * or denies the permission.
 */
export async function pickFromLibrary(): Promise<string | null> {
  const ok = await ensureLibraryPermission();
  if (!ok) return null;
  const result = await ImagePicker.launchImageLibraryAsync({
    // SDK 54 accepts the lowercase `MediaType` literal; the older
    // `MediaTypeOptions.Images` is deprecated.
    mediaTypes: "images",
    allowsEditing: false,
    quality: 0.9,
    // Only one photo per identify — keeps the annotator flow simple.
    allowsMultipleSelection: false,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  return asset?.uri ?? null;
}

/**
 * Take a photo through the system camera UI. `camera.tsx` already has a
 * live-preview capture path; this is a fallback / parity helper for
 * screens that only need a still photo without embedding a CameraView.
 */
export async function pickFromCamera(): Promise<string | null> {
  const ok = await ensureCameraPermission();
  if (!ok) return null;
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: "images",
    allowsEditing: false,
    quality: 0.9,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  return asset?.uri ?? null;
}
