/**
 * Offline bounce — renders the active engine session to WAV via Tracktion Renderer.
 */
import { engineClient, unwrapEngineResult } from "./engineClient";

export interface RenderExportResult {
  outputFilePath: string;
  startSeconds?: number;
  endSeconds?: number;
}

export interface ExportMixOptions {
  suggestedName: string;
  startSeconds?: number;
  endSeconds?: number;
  normalizePeak?: boolean;
}

async function pickOutputPath(suggestedName: string): Promise<string | null> {
  try {
    const { save } = await import("@tauri-apps/plugin-dialog");
    return save({
      defaultPath: suggestedName.endsWith(".wav") ? suggestedName : `${suggestedName}.wav`,
      filters: [{ name: "WAV Audio", extensions: ["wav"] }],
    });
  } catch {
    console.warn("[renderExport] dialog unavailable — browser dev mode");
    return null;
  }
}

export async function exportSessionMix(
  suggestedNameOrOptions: string | ExportMixOptions,
): Promise<RenderExportResult | null> {
  const opts: ExportMixOptions =
    typeof suggestedNameOrOptions === "string"
      ? { suggestedName: suggestedNameOrOptions }
      : suggestedNameOrOptions;

  const outputPath = await pickOutputPath(opts.suggestedName);
  if (!outputPath) return null;

  const raw = await engineClient.renderMix(outputPath, {
    startSeconds: opts.startSeconds,
    endSeconds: opts.endSeconds,
    normalizePeak: opts.normalizePeak,
  });
  return unwrapEngineResult<RenderExportResult>(raw);
}

/** Bounce the current edit selection (Audacity / Ardour range export). */
export async function exportEditSelection(
  suggestedName: string,
  startSeconds: number,
  endSeconds: number,
): Promise<RenderExportResult | null> {
  if (endSeconds <= startSeconds) return null;
  return exportSessionMix({
    suggestedName,
    startSeconds,
    endSeconds,
  });
}
