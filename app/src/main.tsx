import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyDocument } from "./lib/i18n";
import { initTheme } from "./lib/theme";
import "./index.css";

initTheme();
applyDocument();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
