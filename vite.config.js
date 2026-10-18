import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build works from any sub-directory (e.g. GitHub Pages).
  base: './',
  build: {
    chunkSizeWarningLimit: 1000,
  },
});
