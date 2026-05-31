import { definePlugin } from 'nitro'
import { useDatabase } from 'nitro/database'
import { useStorage } from 'nitro/storage'
import db0Driver from 'unstorage/drivers/db0'
import { pruneSessionModel } from '../lib/session-model-store.ts'

export default definePlugin(() => {
  const storage = useStorage()
  if (storage.getMount('/session-model').base === '/session-model') {
    return
  }

  storage.mount(
    '/session-model',
    db0Driver({
      database: useDatabase(),
      tableName: 'betterzeriya_session_model',
    }),
  )

  void pruneSessionModel()
  const timer = setInterval(
    () => {
      void pruneSessionModel()
    },
    60 * 60 * 1000,
  )
  timer.unref?.()
})
