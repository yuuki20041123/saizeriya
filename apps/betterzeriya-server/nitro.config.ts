import { defineConfig } from 'nitro'

const isEnabled = (value: string | undefined) => value === '1' || value === 'true'
const cloudflareSessionsKVNamespaceId = process.env.CLOUDFLARE_SESSIONS_KV_NAMESPACE_ID?.trim()
const cloudflareSessionsKVPreviewNamespaceId =
  process.env.CLOUDFLARE_SESSIONS_KV_PREVIEW_NAMESPACE_ID?.trim()

const preset = isEnabled(process.env.NODE)
  ? 'node-server'
  : isEnabled(process.env.CLOUDFLARE)
    ? 'cloudflare-durable'
    : isEnabled(process.env.BUN) || isEnabled(process.env.BUN_1)
      ? 'bun'
      : undefined

if (preset) {
  process.env.NITRO_PRESET = preset
}

const cloudflare = isEnabled(process.env.CLOUDFLARE)
  ? {
      wrangler: {
        ...(cloudflareSessionsKVNamespaceId
          ? {
              kv_namespaces: [
                {
                  binding: 'BETTERZERIYA_SESSIONS',
                  id: cloudflareSessionsKVNamespaceId,
                  ...(cloudflareSessionsKVPreviewNamespaceId
                    ? { preview_id: cloudflareSessionsKVPreviewNamespaceId }
                    : {}),
                },
              ],
            }
          : {}),
        durable_objects: {
          bindings: [
            {
              name: '$DurableObject',
              class_name: '$DurableObject',
            },
          ],
        },
        migrations: [
          {
            tag: 'v1',
            new_classes: ['$DurableObject'],
          },
        ],
      },
    }
  : undefined

const usesCloudflareKV = Boolean(cloudflare)
const usesDatabaseStorage = !usesCloudflareKV

export default defineConfig({
  serverDir: './server',
  ...(preset ? { preset } : {}),
  experimental: {
    database: usesDatabaseStorage,
  },
  ...(usesDatabaseStorage
    ? {
        database: {
          default: {
            connector:
              isEnabled(process.env.BUN) || isEnabled(process.env.BUN_1) ? 'bun-sqlite' : 'sqlite',
            options: {
              name: 'betterzeriya-sessions',
            },
          },
        },
      }
    : {}),
  ...(usesCloudflareKV
    ? {
        storage: {
          'session-model': {
            driver: 'cloudflare-kv-binding',
            binding: 'BETTERZERIYA_SESSIONS',
          },
        },
      }
    : {}),
  ...(cloudflare ? { cloudflare } : {}),
  ...(cloudflare
    ? { alias: { 'saizeriya.js/browser-mode': './server/lib/browser-mode-unavailable.ts' } }
    : {}),
})
