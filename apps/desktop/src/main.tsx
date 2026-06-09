import React from "react";
import ReactDOM from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";
import { initNativeWindowShell } from "./lib/windowShell";

initNativeWindowShell();

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Missing #root element");
}

function showBootError(err: unknown) {
  rootEl.innerHTML = `<pre style="padding:24px;color:#f87171;font:12px monospace;white-space:pre-wrap">${
    err instanceof Error ? err.stack ?? err.message : String(err)
  }</pre>`;
}

function hideBootFallback() {
  document.getElementById("boot-fallback")?.remove();
}

async function boot() {
  try {
    const { default: App } = await import("./App");
    ReactDOM.createRoot(rootEl).render(
      <React.StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </React.StrictMode>,
    );
    hideBootFallback();
  } catch (err) {
    hideBootFallback();
    showBootError(err);
  }
}

void boot();
