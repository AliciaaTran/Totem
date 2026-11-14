import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  // Relative asset paths, so the built site works under any sub-path
  // (GitHub Pages serves it from /Totem/).
  base: './',
  build: {
    rollupOptions: {
      // Two separate pages (plus a redirecting index) so static hosts like
      // Cloudflare Pages can serve /generator/ and /decode/ directly.
      input: {
        main: root('./index.html'),
        generator: root('./generator/index.html'),
        decode: root('./decode/index.html'),
      },
    },
  },
  server: {
    // Listen on the local network so a phone on the same Wi-Fi can scan test QR codes.
    host: true,
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
