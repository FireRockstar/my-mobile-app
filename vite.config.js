import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Capacitor loads the built app from a local file:// / capacitor:// origin
  // on the device, so asset paths must be relative, not absolute (/assets/..).
  base: "./",
});
