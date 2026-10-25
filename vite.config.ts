import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base so the build works on any static host, including GitHub Pages subpaths.
export default defineConfig({
  plugins: [react()],
  base: './',
})
