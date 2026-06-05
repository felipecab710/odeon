import { useProjectStore } from "../../stores/projectStore";

export function ImportProgress() {
  const pending = useProjectStore((s) => s.pendingTracks);

  if (pending.length === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[480px] max-w-[90vw] pointer-events-none">
      <div
        className="rounded-lg border border-white/10 shadow-2xl overflow-hidden"
        style={{ background: "rgba(28,28,32,0.97)", backdropFilter: "blur(12px)" }}
      >
        {/* Title bar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/8">
          <span className="text-[11px] font-semibold tracking-widest uppercase text-studio-muted">
            Import
          </span>
          <span className="text-[11px] text-studio-muted">
            {pending.length} file{pending.length > 1 ? "s" : ""}
          </span>
        </div>

        {/* File list */}
        <div className="flex flex-col gap-0 divide-y divide-white/5">
          {pending.map((p, i) => (
            <FileRow key={p.id} index={i} total={pending.length} {...p} />
          ))}
        </div>
      </div>
    </div>
  );
}

interface FileRowProps {
  index: number;
  total: number;
  fileName: string;
  status: string;
  operation: string;
}

function FileRow({ index, total, fileName, status, operation }: FileRowProps) {
  const isAnalyzing = status === "analyzing";

  return (
    <div className="px-4 py-3">
      {/* Counter + file name */}
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-[10px] text-studio-muted shrink-0">
          {index + 1} of {total}
        </span>
        <span
          className="text-[12px] font-medium text-white/90 truncate"
          title={fileName}
        >
          {fileName}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-white/8 overflow-hidden mb-2">
        <div
          className={`h-full rounded-full transition-all ${
            isAnalyzing
              ? "bg-blue-500 animate-[scan_1.4s_ease-in-out_infinite]"
              : "bg-orange-400 animate-[scan_1.8s_ease-in-out_infinite]"
          }`}
          style={{ width: "45%" }}
        />
      </div>

      {/* Operation label */}
      <div className="text-[10px] text-studio-muted truncate">{operation}</div>
    </div>
  );
}
