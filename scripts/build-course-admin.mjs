import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
await build({
  root,
  configFile: false,
  plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'release/course-admin',
    emptyOutDir: false,
    copyPublicDir: false,
    lib: {
      entry: 'integrations/main-site-admin/browser.jsx',
      formats: ['es'],
      fileName: () => 'course-editor.js',
      cssFileName: 'course-editor',
    },
  },
});
