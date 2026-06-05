import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CLIP_COLOR_PRESETS } from "../../lib/clipColorPresets";
import { useTrackGroupStore } from "../../stores/trackGroupStore";
import type { TrackGroupSharing } from "../../lib/trackGroup";

function Checkbox({
  checked,
  onChange,
  label,
  indent,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  indent?: boolean;
}) {
  return (
    <label
      className="flex items-center gap-2 cursor-pointer select-none"
      style={{ paddingLeft: indent ? 18 : 0 }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-[#4a90d9]"
        style={{ width: 13, height: 13 }}
      />
      <span style={{ fontSize: 11, color: "#d0d0d0" }}>{label}</span>
    </label>
  );
}

export function TrackGroupEditDialog() {
  const editingGroupId = useTrackGroupStore((s) => s.editingGroupId);
  const group = useTrackGroupStore((s) =>
    s.editingGroupId ? s.groups.find((g) => g.id === s.editingGroupId) ?? null : null
  );
  const updateGroup = useTrackGroupStore((s) => s.updateGroup);
  const deleteGroup = useTrackGroupStore((s) => s.deleteGroup);
  const closeEditDialog = useTrackGroupStore((s) => s.closeEditDialog);

  const [name, setName] = useState("");
  const [active, setActive] = useState(true);
  const [color, setColor] = useState(CLIP_COLOR_PRESETS[0].color);
  const [sharing, setSharing] = useState<TrackGroupSharing>({
    gain: true, gainRelative: true, muting: true, soloing: true,
    recordEnable: true, selection: true, activeState: true, color: true, monitoring: true,
  });

  useEffect(() => {
    if (!group) return;
    setName(group.name);
    setActive(group.active);
    setColor(group.color);
    setSharing({ ...group.sharing });
  }, [group]);

  const patchSharing = useCallback((key: keyof TrackGroupSharing, value: boolean) => {
    setSharing((s) => {
      const next = { ...s, [key]: value };
      if (key === "gain" && !value) next.gainRelative = false;
      return next;
    });
  }, []);

  const handleSave = () => {
    if (!group) return;
    updateGroup(group.id, { name: name.trim() || group.name, active, color, sharing });
    closeEditDialog();
  };

  const handleDelete = () => {
    if (!group) return;
    deleteGroup(group.id);
    closeEditDialog();
  };

  if (!editingGroupId || !group) return null;

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 20000, background: "rgba(0,0,0,0.55)" }}
      onClick={closeEditDialog}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 280,
          background: "#2a2a2a",
          border: "1px solid #1a1a1a",
          borderRadius: 6,
          boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* Title bar */}
        <div
          className="flex items-center justify-center relative"
          style={{
            height: 28,
            background: "linear-gradient(180deg, #3a3a3a 0%, #2e2e2e 100%)",
            borderBottom: "1px solid #1a1a1a",
            borderRadius: "6px 6px 0 0",
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 600, color: "#e0e0e0" }}>
            Track/bus Group
          </span>
          <button
            type="button"
            onClick={closeEditDialog}
            className="absolute right-2"
            style={{ fontSize: 14, color: "#888", background: "none", border: "none", cursor: "pointer" }}
          >
            ×
          </button>
        </div>

        <div className="px-4 py-3 flex flex-col gap-3">
          {/* Name */}
          <div className="flex items-center gap-2">
            <label style={{ fontSize: 11, color: "#aaa", width: 48 }}>Name:</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 px-2 py-0.5 rounded"
              style={{
                fontSize: 11,
                background: "#1e1e1e",
                border: "1px solid #444",
                color: "#e8e8e8",
              }}
            />
          </div>

          {/* Active */}
          <Checkbox checked={active} onChange={setActive} label="Active" />

          {/* Color */}
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 11, color: "#aaa", width: 48 }}>Color</span>
            <div className="flex gap-1 flex-wrap">
              {CLIP_COLOR_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  title={preset.label}
                  onClick={() => setColor(preset.color)}
                  style={{
                    width: 28,
                    height: 14,
                    background: preset.color,
                    border: color === preset.color ? "2px solid #fff" : "1px solid #555",
                    borderRadius: 2,
                    cursor: "pointer",
                  }}
                />
              ))}
            </div>
          </div>

          {/* Sharing */}
          <div>
            <div style={{ fontSize: 11, color: "#aaa", marginBottom: 6 }}>Sharing</div>
            <div className="flex flex-col gap-1.5">
              <Checkbox checked={sharing.gain} onChange={(v) => patchSharing("gain", v)} label="Gain" />
              <Checkbox
                checked={sharing.gainRelative}
                onChange={(v) => patchSharing("gainRelative", v)}
                label="Relative"
                indent
              />
              <Checkbox checked={sharing.muting} onChange={(v) => patchSharing("muting", v)} label="Muting" />
              <Checkbox checked={sharing.soloing} onChange={(v) => patchSharing("soloing", v)} label="Soloing" />
              <Checkbox checked={sharing.recordEnable} onChange={(v) => patchSharing("recordEnable", v)} label="Record enable" />
              <Checkbox checked={sharing.selection} onChange={(v) => patchSharing("selection", v)} label="Selection" />
              <Checkbox checked={sharing.activeState} onChange={(v) => patchSharing("activeState", v)} label="Active state" />
              <Checkbox checked={sharing.color} onChange={(v) => patchSharing("color", v)} label="Color" />
              <Checkbox checked={sharing.monitoring} onChange={(v) => patchSharing("monitoring", v)} label="Monitoring" />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between px-4 py-2"
          style={{ borderTop: "1px solid #333" }}
        >
          <button
            type="button"
            onClick={handleDelete}
            style={{ fontSize: 11, color: "#e74c3c", background: "none", border: "none", cursor: "pointer" }}
          >
            Delete Group
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={closeEditDialog}
              className="px-3 py-1 rounded"
              style={{ fontSize: 11, background: "#333", color: "#ccc", border: "1px solid #444" }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-3 py-1 rounded"
              style={{ fontSize: 11, background: "#4a90d9", color: "#fff", border: "none" }}
            >
              OK
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
