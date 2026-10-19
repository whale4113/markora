import {defineConfig} from 'vite';
export default defineConfig({base:'./',build:{target:'esnext',minify:false,chunkSizeWarningLimit:2200}});
