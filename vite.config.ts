import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import {
  isHmrDisabled,
  laplaceRookBuildHmrGuard,
} from "./scripts/vite-rook-hmr-guard.mjs";

const disableHmr = isHmrDisabled();

export default defineConfig({
  plugins: [react(), ...(disableHmr ? [] : [laplaceRookBuildHmrGuard()])],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    ...(disableHmr ? { hmr: false, watch: null } : {}),
  },
});
