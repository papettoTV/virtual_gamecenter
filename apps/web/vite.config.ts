import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { networkInterfaces } from "node:os";
import { defineConfig, type Plugin } from "vite";

function localAddressApi(): Plugin {
  return {
    name: "local-address-api",
    configureServer(server) {
      server.middlewares.use("/api/local-address", (_request, response) => {
        const addresses = Object.values(networkInterfaces()).flat();
        const lanAddress = addresses.find(
          (address) =>
            address?.family === "IPv4"
            && !address.internal
            && !address.address.startsWith("169.254."),
        );
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(JSON.stringify({ address: lanAddress?.address ?? "localhost", port: 5174 }));
      });
    },
  };
}

export default defineConfig({
  plugins: [localAddressApi(), react(), cloudflare()],
  server: {
    host: "0.0.0.0",
    port: 5174,
    strictPort: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
  },
});
