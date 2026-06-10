/**
 * File dialogs for Audacity-compatible locator label import/export.
 */
import type { SetLocator } from "../stores/setLocatorStore";
import { useSetLocatorStore } from "../stores/setLocatorStore";
import { captureUndoState } from "../stores/undoStore";
import { locatorsToAudacityLabels, parseAudacityLabels } from "./locatorLabels";

export async function exportLocatorsToFile(locators: SetLocator[]): Promise<string | null> {
  if (!locators.length) return null;
  try {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({
      defaultPath: "locators.txt",
      filters: [{ name: "Audacity Labels", extensions: ["txt"] }],
    });
    if (!path) return null;
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    await writeTextFile(path, locatorsToAudacityLabels(locators));
    return path;
  } catch (e) {
    console.warn("[locatorLabelsIO] export failed", e);
    return null;
  }
}

export async function importLocatorsFromFile(): Promise<number> {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({
      filters: [{ name: "Audacity Labels", extensions: ["txt"] }],
      multiple: false,
    });
    if (!path || Array.isArray(path)) return 0;
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    const text = await readTextFile(path);
    const parsed = parseAudacityLabels(text);
    if (!parsed.length) return 0;
    captureUndoState();
    useSetLocatorStore.getState().replaceLocators(
      parsed.map(p => ({ id: crypto.randomUUID(), ...p })),
    );
    return parsed.length;
  } catch (e) {
    console.warn("[locatorLabelsIO] import failed", e);
    return 0;
  }
}
