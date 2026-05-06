/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Tauri config notes:
// - Tauri expects the dev server on a fixed port; we use 1420.
// - HMR for mobile (Android) requires hostname & port from TAURI_DEV_HOST.
//   See https://v2.tauri.app/start/frontend/vite/
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host ?? false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    // Tauri 2 webview floors:
    //   macOS WKWebView 2024+ → Safari 17+
    //   Linux WebKitGTK 2.40+ → Safari 17 equivalent
    //   Windows WebView2     → Chrome 120+
    //   Android System WebView 2024+ → Chrome 120+
    // safari14 is the spec floor where destructuring + async iter
    // transpile cleanly under Vite 8 / esbuild 0.28 without falling
    // back to runtime helpers.
    target:
      process.env.TAURI_ENV_PLATFORM === "windows"
        ? "chrome120"
        : "safari17",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
  test: {
    environment: "happy-dom",
    setupFiles: ["./src/test-setup.ts"],
    globals: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    css: false,
  },
});
