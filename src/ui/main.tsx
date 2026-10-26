import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";
import "./index.css";
import { loadPrefs } from "./lib/prefs";

ModuleRegistry.registerModules([AllCommunityModule]);

// Preferences come from the backend; load them before the app module (and its persisted stores) is evaluated
// so the stores hydrate synchronously and there is no flash of default theme/settings.
await loadPrefs();
const { App } = await import("./App");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
