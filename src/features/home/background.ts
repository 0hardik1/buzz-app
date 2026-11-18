import { readView, writeView } from "../../shared/view-state";
import { canvasFile } from "./canvas-files";
export const backgroundKey = "home:background:v1";
export function backgroundId(scope: string) {
  const value = readView<unknown>(scope, backgroundKey, null);
  return typeof value === "string" && /^[a-f0-9-]{36}$/.test(value)
    ? value
    : undefined;
}

/** Save new bytes before publishing their identity; failed/superseded selections leave no broken background. */
export async function setHomeBackground(
  scope: string,
  file: File | null,
  signal: AbortSignal,
) {
  let id: string | undefined;
  if (file) {
    if (
      !/^image\/(jpeg|png|webp|avif|gif)$/.test(file.type) ||
      file.size > 20 * 1024 * 1024
    )
      throw new Error("Choose a JPEG, PNG, WebP, AVIF, or GIF under 20 MB.");
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
    } catch {
      throw new Error("This image could not be opened. Try another photo.");
    } finally {
      URL.revokeObjectURL(url);
    }
    signal.throwIfAborted();
    id = crypto.randomUUID();
    await canvasFile(scope, id, file);
  }
  try {
    signal.throwIfAborted();
    const previous = backgroundId(scope);
    if (!writeView(scope, backgroundKey, id ?? null))
      throw new Error("Your background could not be saved on this device.");
    if (previous) await canvasFile(scope, previous, null);
  } catch (error) {
    // A successful selection already published this ID; retain it if only old-file cleanup failed.
    if (id && backgroundId(scope) !== id) await canvasFile(scope, id, null);
    throw error;
  }
}
