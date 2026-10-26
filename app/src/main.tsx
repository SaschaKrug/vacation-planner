import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyDocument } from "./lib/i18n";
import { initTheme } from "./lib/theme";
import "./index.css";

// The app's address lives after the "#", so the page itself is always "/". GitHub Pages
// answers any other path with 404.html and status 404, which browsers neither cache nor
// restore, so the app loaded again whenever the browser reopened it. Links from before
// (/f/<id>, /setup/<token>, /?s=<id>) move behind the "#".
if (!location.hash && (location.pathname !== "/" || location.search)) {
  history.replaceState(null, "", `/#${location.pathname}${location.search}`);
}

initTheme();
applyDocument();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
