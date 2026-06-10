/**
 * Offline bounce — renders the active engine session to WAV via Tracktion Renderer.
 */
import { engineClient, unwrapEngineResult } from "./engineClient";

export interface RenderExportResult {
  outputFilePath: string;
}

export async function exportSessionMix(suggestedName: string): Promise<RenderExportResult | null> {
  let outputPath: string | null = null;
  try {
    const { save } = await import("@tauri-apps/plugin-dialog");
    outputPath = await save({
      defaultPath: suggestedName.endsWith(".wav") ? suggestedName : `${suggestedName}.wav`,
      filters: [{ name: "WAV Audio", extensions: ["wav"] }],
    });
  } catch {
    console.warn("[renderExport] dialog unavailable — browser dev mode");
    return null;
  }

  if (!outputPath) return null;

  const raw = await engineClient.renderMix(outputPath);
  return unwrapEngineResult<RenderExportResult>(raw);
}
