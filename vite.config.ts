import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

export default defineConfig(() => ({
  server: {
    host: "::",
    port: 4100,
    strictPort: true,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "apple-touch-icon.png", "robots.txt"],
      manifest: {
        name: "Decent microsystem",
        short_name: "Decent",
        description:
          "One system for the restaurant, bar and rooms of your hospitality business.",
        theme_color: "#a32420",
        background_color: "#ffffff",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Precache the static app shell (JS/CSS/HTML/icons). This makes repeat
        // loads instant and cuts egress — but we NEVER cache Supabase data, so
        // numbers always come live off the wire (the app is online-only).
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        navigateFallback: "index.html",
        runtimeCaching: [
          {
            // Supabase REST / auth / realtime / storage — always hit the network.
            urlPattern: ({ url }) => url.hostname.endsWith(".supabase.co"),
            handler: "NetworkOnly",
          },
        ],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
  build: {
    // A data-heavy SPA legitimately ships a few hundred KB of framework code;
    // it's precached by the service worker, so this limit just quiets the noise.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Split vendor libraries into stable, separately-cached chunks. Total
        // bytes are the same, but an app-code change no longer busts the big
        // framework chunks — so updates download fast and load faster.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("@supabase")) return "supabase";
          if (id.includes("@tanstack")) return "query";
          if (id.includes("react-router") || id.includes("@remix-run")) return "router";
          if (id.includes("react-hook-form") || id.includes("@hookform") || id.includes("zod"))
            return "forms";
          if (id.includes("date-fns") || id.includes("react-day-picker")) return "dates";
          if (
            id.includes("@radix-ui") ||
            id.includes("lucide-react") ||
            id.includes("cmdk") ||
            id.includes("vaul") ||
            id.includes("sonner") ||
            id.includes("class-variance-authority") ||
            id.includes("tailwind-merge")
          )
            return "ui";
          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/scheduler/")
          )
            return "react";
          return "vendor";
        },
      },
    },
  },
}));
