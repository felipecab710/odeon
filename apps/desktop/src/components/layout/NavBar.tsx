import { useNavigationStore, type NavView } from "../../stores/navigationStore";

interface NavItem {
  id: NavView;
  label: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: "studio",   label: "Studio",   icon: "⊞" },
  { id: "select",   label: "Select",   icon: "◈" },
  { id: "research", label: "Research", icon: "⊿" },
  { id: "settings", label: "Settings", icon: "⚙" },
];

export function NavBar() {
  const { view, navigate } = useNavigationStore();

  return (
    <nav
      className="flex items-center gap-1 px-3 border-b border-studio-border"
      style={{ height: 36, background: "#1a1a1a", flexShrink: 0 }}
    >
      {NAV_ITEMS.map((item) => {
        const active = view === item.id;
        return (
          <button
            key={item.id}
            onClick={() => navigate(item.id)}
            className="flex items-center gap-1.5 px-3 py-1 rounded text-xs transition-colors"
            style={{
              color: active ? "#fff" : "#888",
              background: active ? "rgba(255,255,255,0.08)" : "transparent",
              fontWeight: active ? 600 : 400,
              border: "none",
              cursor: "pointer",
            }}
          >
            <span style={{ fontSize: 12, lineHeight: 1 }}>{item.icon}</span>
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
