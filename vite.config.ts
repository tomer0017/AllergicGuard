import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ command, isPreview }) => ({
  // The production build is served from https://tomer0017.github.io/AllergicGuard/,
  // so assets must be prefixed with the repository path. `npm run preview` gets
  // the same base — otherwise it serves the built HTML at the wrong root and
  // every asset 404s, which is not a useful rehearsal of production.
  // `npm run dev` keeps the plain root so the local server stays at
  // http://localhost:5173/.
  base: command === 'build' || isPreview ? '/AllergicGuard/' : '/',
  plugins: [react()],
}))
