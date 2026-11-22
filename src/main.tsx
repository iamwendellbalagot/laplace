import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { TauriAppService } from "./services/app-service";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root element.");

createRoot(root).render(
  <StrictMode>
    <App service={new TauriAppService()} />
  </StrictMode>,
);
