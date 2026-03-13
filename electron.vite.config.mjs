import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    entry: 'src/main-zuki/index.js',
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    input: 'src/preload-zuki/index.js',
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer-zuki/src')
      }
    },
    plugins: [react()] // <--- No more Monaco plugin causing crashes
  }
})