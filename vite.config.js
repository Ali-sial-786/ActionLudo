import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build works from any sub-directory (e.g. GitHub Pages).
  base: './',
  build: {
    chunkSizeWarningLimit: 1000,
    // The single-page Artifact build (scripts/build-artifact.mjs) inlines every asset, sounds
    // included; the normal build keeps sounds as separate, cacheable files.
    assetsInlineLimit: process.env.VITE_ARTIFACT ? Number.MAX_SAFE_INTEGER : 4096,
  },
});
