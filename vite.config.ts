import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // The production build is served from https://tomer0017.github.io/AllergicGuard/,
  // so assets must be prefixed with the repository path. `npm run dev` keeps the
  // plain root base so the local server stays at http://localhost:5173/.
  base: command === 'build' ? '/AllergicGuard/' : '/',
  plugins: [react()],
}))
