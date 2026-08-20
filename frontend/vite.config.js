import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

import {
  createContentSecurityPolicy,
} from "./config/csp.config.js";

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const environment = loadEnv(
    mode,
    import.meta.dirname,
    "",
  );

  const apiBaseUrl =
    environment.VITE_API_BASE_URL ||
    "http://localhost:3001/api";

  const developmentPolicy =
    createContentSecurityPolicy({
      apiBaseUrl,
      isDevelopment:
        command === "serve" &&
        mode === "development",
    });

  const previewPolicy =
    createContentSecurityPolicy({
      apiBaseUrl,
      isDevelopment: false,
    });

    //
    const permissionsPolicy = [
      "accelerometer=()",
      "camera=()",
      "display-capture=()",
      "geolocation=()",
      "gyroscope=()",
      "magnetometer=()",
      "microphone=()",
      "payment=()",
      "usb=()",
    ].join(", ");

    function createSecurityHeaders(contentSecurityPolicy) {
      return {
        "Content-Security-Policy": contentSecurityPolicy,
        "Permissions-Policy": permissionsPolicy,
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
      };
    }
    //

  return {
    plugins: [react(), tailwindcss()],

    server: {
      headers: createSecurityHeaders( 
          developmentPolicy,
      ),
    },

    preview: {
      cors: false,
      headers: createSecurityHeaders(
          previewPolicy,
      ),
    },
  };
});
