import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // xfwd passes each client's real IP to the server, which identifies participants by device.
      '/api': { target: 'http://localhost:3001', xfwd: true },
      '/socket.io': { target: 'http://localhost:3001', ws: true, xfwd: true },
    },
  },
});
