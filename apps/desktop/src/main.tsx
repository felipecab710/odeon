import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { initNativeWindowShell } from "./lib/windowShell";

initNativeWindowShell();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
