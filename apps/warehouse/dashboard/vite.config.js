import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Built straight into the API's wwwroot, so the warehouse API image carries the
// dashboard with it and there is no second thing to deploy or keep in step.
//
// Served at /warehouse/ by the platform gateway, next to the courier portal on
// the same address. The API also answers /warehouse/... when run on its own, so
// one build works both ways.
export default defineConfig({
  base: '/warehouse/',
  plugins: [react()],
  build: {
    outDir: '../server/Warehouse.Api/wwwroot',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // In development the dashboard runs on Vite. The proxy points it at the
    // platform gateway, so /api/... reaches the warehouse API and the platform
    // sign-in and the courier portal are one click away, exactly as deployed.
    proxy: {
      '/api': { target: process.env.PLATFORM_URL ?? 'http://127.0.0.1:5080', changeOrigin: true },
      '/uploads': { target: process.env.PLATFORM_URL ?? 'http://127.0.0.1:5080', changeOrigin: true },
    },
  },
});
