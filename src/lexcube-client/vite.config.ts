import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  root: 'src/client',
  publicDir: 'public',
  assetsInclude: ['**/*.glb', '**/*.gltf'],
  resolve: {
    alias: {
      three: path.resolve(__dirname, 'node_modules/three'),
    },
  },
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
})
