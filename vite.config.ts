import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: 'localhost', port: 5173 }, // Web Serial needs HTTPS or localhost
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  test: { environment: 'node' },
});
