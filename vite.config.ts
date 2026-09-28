import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    // GitHub Pages project site: https://calionauta.github.io/sessionmap/
    base: '/sessionmap/',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        // import.meta.dirname instead of __dirname: Vite 8's native config
        // loader is ESM, where __dirname is not defined and emits a
        // deprecation warning.
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
