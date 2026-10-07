import { defineConfig } from 'vite'

/** 建置指紋：CI 用 commit SHA，本機用時間戳 */
const appVersion =
  process.env.GITHUB_SHA?.slice(0, 12) ||
  process.env.VITE_APP_VERSION ||
  `dev-${Date.now().toString(36)}`

const rootDir = import.meta.dirname

/** GitHub Pages 專案站：https://<user>.github.io/tower-annals/ */
export default defineConfig({
  base: '/tower-annals/',
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  build: {
    rollupOptions: {
      input: {
        main: `${rootDir}/index.html`,
        spore: `${rootDir}/spore/index.html`,
      },
    },
  },
  plugins: [
    {
      name: 'emit-version-json',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ version: appVersion }, null, 0),
        })
      },
    },
  ],
})
