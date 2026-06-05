import { usePlaybackEngineStore, formatBufferLabel } from "../../stores/playbackEngineStore";
import type { BufferSizeSamples, DiskCacheSize } from "@odeon/shared";

const BUFFER_OPTIONS: BufferSizeSamples[] = [64, 128, 256, 512, 1024];
const CACHE_OPTIONS: { value: DiskCacheSize; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "normal", label: "Normal" },
  { value: "large", label: "Large" },
];

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold text-[#c8c8c8] uppercase tracking-wide mb-2">
      {children}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-[11px] text-[#9a9a9a] mb-1">{children}</label>;
}

function Select({
  value,
  onChange,
  children,
  disabled,
}: {
  value: string | number;
  onChange: (v: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-7 px-2 rounded bg-[#2a2a2a] border border-[#3d3d3d] text-[#e8e8e8] text-xs focus:outline-none focus:border-[#4a90d9] disabled:opacity-50"
    >
      {children}
    </select>
  );
}

function Checkbox({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex items-start gap-2 cursor-pointer group">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 accent-[#4a90d9]"
      />
      <span>
        <span className="text-xs text-[#d8d8d8] group-hover:text-white">{label}</span>
        {hint && <span className="block text-[10px] text-[#6a6a6a] mt-0.5">{hint}</span>}
      </span>
    </label>
  );
}

export function PlaybackEngineDialog() {
  const {
    isOpen,
    isLoading,
    isSaving,
    error,
    status,
    draft,
    close,
    patchDraft,
    apply,
    refresh,
  } = usePlaybackEngineStore();

  if (!isOpen) return null;

  const sampleRate = status?.sampleRate ?? draft.sampleRate;
  const devices = status?.outputDevices ?? [];
  const bufferSizes =
    status?.availableBufferSizes?.length
      ? (status.availableBufferSizes as BufferSizeSamples[])
      : BUFFER_OPTIONS;

  const currentDevice =
    draft.outputDeviceName ||
    status?.currentOutputDevice ||
    devices.find((d) => d.isCurrent)?.name ||
    "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={close}
    >
      <div
        className="w-[520px] max-h-[90vh] overflow-y-auto rounded bg-[#1e1e1e] border border-[#3a3a3a] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#3a3a3a]">
          <h2 className="text-sm font-semibold text-[#e8e8e8]">Playback Engine</h2>
          {status && (
            <span className="text-[10px] text-[#6a6a6a]">
              {status.deviceType} · CPU {(status.cpuUsage * 100).toFixed(0)}%
            </span>
          )}
        </div>

        <div className="p-4 space-y-5">
          {error && (
            <div className="text-xs text-[#e8a87c] bg-[#2a2018] border border-[#4a3828] rounded px-3 py-2">
              {error}
              {!status && " — settings saved locally; native engine will apply when available."}
            </div>
          )}

          {/* Device */}
          <section>
            <SectionTitle>Device</SectionTitle>
            <FieldLabel>Playback Engine</FieldLabel>
            <Select
              value={currentDevice}
              disabled={isLoading || devices.length === 0}
              onChange={(v) => patchDraft({ outputDeviceName: v })}
            >
              {devices.length === 0 ? (
                <option value={currentDevice}>{currentDevice || "Default Output"}</option>
              ) : (
                devices.map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name}
                  </option>
                ))
              )}
            </Select>
          </section>

          {/* Settings */}
          <section>
            <SectionTitle>Settings</SectionTitle>
            <FieldLabel>H/W Buffer Size</FieldLabel>
            <Select
              value={draft.bufferSizeSamples}
              disabled={isLoading}
              onChange={(v) =>
                patchDraft({ bufferSizeSamples: Number(v) as BufferSizeSamples })
              }
            >
              {bufferSizes.map((s) => (
                <option key={s} value={s}>
                  {formatBufferLabel(s, sampleRate)}
                </option>
              ))}
            </Select>
          </section>

          {/* Optimizations */}
          <section>
            <SectionTitle>Optimizations</SectionTitle>
            <div className="space-y-3">
              <div>
                <FieldLabel>Ignore Errors During Playback/Record for:</FieldLabel>
                <div className="space-y-2 mt-1 pl-1">
                  <Checkbox
                    checked={draft.ignoreErrorsMainPlayback}
                    onChange={(v) => patchDraft({ ignoreErrorsMainPlayback: v })}
                    label="Main Playback Engine"
                  />
                  <Checkbox
                    checked={draft.ignoreErrorsAuxIo}
                    onChange={(v) => patchDraft({ ignoreErrorsAuxIo: v })}
                    label="Aux I/O"
                    hint="May cause clicks and pops."
                  />
                </div>
              </div>

              <Checkbox
                checked={draft.dynamicPluginProcessing}
                onChange={(v) => patchDraft({ dynamicPluginProcessing: v })}
                label="Dynamic Plugin Processing"
                hint="Plugins only use CPU resources when processing audio."
              />

              <Checkbox
                checked={draft.optimizeLowBuffer}
                onChange={(v) => patchDraft({ optimizeLowBuffer: v })}
                label="Optimize Performance at Low Buffer Sizes"
                hint="Certain plugins may cause brief system hangs."
              />

              <div>
                <Checkbox
                  checked={draft.maxRealtimeThreads > 0}
                  onChange={(v) =>
                    patchDraft({ maxRealtimeThreads: v ? 2 : 0 })
                  }
                  label="Limit Number of Real-Time Threads"
                  hint="Reduces contention with non-Odeon processes."
                />
                {draft.maxRealtimeThreads > 0 && (
                  <div className="mt-2 ml-5">
                    <Select
                      value={draft.maxRealtimeThreads}
                      onChange={(v) =>
                        patchDraft({ maxRealtimeThreads: Number(v) })
                      }
                    >
                      {[1, 2, 3, 4, 6, 8].map((n) => (
                        <option key={n} value={n}>
                          {n} threads
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Disk Playback */}
          <section>
            <SectionTitle>Disk Playback</SectionTitle>
            <FieldLabel>Cache Size</FieldLabel>
            <Select
              value={draft.diskCacheSize}
              onChange={(v) => patchDraft({ diskCacheSize: v as DiskCacheSize })}
            >
              {CACHE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <p className="text-[10px] text-[#6a6a6a] mt-1">
              Lower values reduce memory usage. Higher values improve disk performance.
            </p>
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-[#3a3a3a]">
          <button
            onClick={() => void refresh()}
            disabled={isLoading}
            className="text-xs text-[#9a9a9a] hover:text-[#e8e8e8] disabled:opacity-40"
          >
            Refresh devices
          </button>
          <div className="flex gap-2">
            <button
              onClick={close}
              className="px-3 h-7 rounded text-xs text-[#9a9a9a] hover:text-[#e8e8e8] border border-[#3d3d3d]"
            >
              Cancel
            </button>
            <button
              onClick={() => void apply()}
              disabled={isSaving}
              className="px-4 h-7 rounded text-xs font-medium bg-[#4a90d9] text-white hover:bg-[#5a9fe9] disabled:opacity-50"
            >
              {isSaving ? "Applying…" : "OK"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
