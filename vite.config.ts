import { defineConfig } from 'vite-plus'

const ignoredPaths = ['packages/server/assets/**', '**/.svelte-kit/**', '**/build/**', '**/dist/**']

export default defineConfig({
  run: {
    tasks: {
      'betterzeriya:dev': {
        command:
          'vp run --filter betterzeriya --filter betterzeriya-server --parallel --log labeled dev',
        cache: false,
      },
    },
  },
  fmt: {
    ignorePatterns: ignoredPaths,
    semi: false,
    singleQuote: true,
  },
  lint: {
    ignorePatterns: ignoredPaths,
  },
})
