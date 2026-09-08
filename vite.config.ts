import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Use relative asset URLs so the same verified build works both at
  // GitHub Pages (/vibe-coding-playground/) and at the Raspberry Pi root (/).
  // A repo-root-only base caused nginx to fall back to index.html for the
  // missing module path, which browsers reject as text/html.
  base: './',
})
