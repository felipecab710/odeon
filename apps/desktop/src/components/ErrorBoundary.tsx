import React from "react";

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[Odeon] render crash:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          position: "fixed", inset: 0, padding: 32, background: "#0f0f0f", color: "#e8e8e8",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12,
          overflow: "auto",
        }}>
          <div style={{ color: "#f87171", fontWeight: 700, marginBottom: 12, fontSize: 14 }}>
            Odeon crashed while rendering
          </div>
          <pre style={{ whiteSpace: "pre-wrap", color: "#fca5a5", marginBottom: 16 }}>
            {this.state.error.message}
          </pre>
          <pre style={{ whiteSpace: "pre-wrap", color: "#888", fontSize: 11 }}>
            {this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
