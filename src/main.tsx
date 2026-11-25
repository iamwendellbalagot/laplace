import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { TauriAppService } from "./services/app-service";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root element.");

createRoot(root).render(
  <StrictMode>
    <AppErrorBoundary>
      <App
        service={new TauriAppService()}
        browserPreview={import.meta.env.VITE_BROWSER_PREVIEW === "1"}
      />
    </AppErrorBoundary>
  </StrictMode>,
);
