import { defineHandler } from 'nitro'
import {
  callStaff,
  createSession,
  getAccount,
  getSession,
  lookupItem,
  setDeviceName,
  setPeopleCount,
  showReceipt,
  submitOrder,
} from '../svelte-api/handlers.ts'

type SvelteHandler = (input: {
  request: Request
  params?: Record<string, string | undefined>
}) => Promise<Response>

const route = (pattern: RegExp, handler: SvelteHandler) => ({ pattern, handler })

const routes = [
  route(/^\/api\/sessions$/, createSession),
  route(/^\/api\/sessions\/([^/]+)$/, getSession),
  route(/^\/api\/sessions\/([^/]+)\/people$/, setPeopleCount),
  route(/^\/api\/sessions\/([^/]+)\/name$/, setDeviceName),
  route(/^\/api\/sessions\/([^/]+)\/lookup$/, lookupItem),
  route(/^\/api\/sessions\/([^/]+)\/submit$/, submitOrder),
  route(/^\/api\/sessions\/([^/]+)\/account$/, getAccount),
  route(/^\/api\/sessions\/([^/]+)\/receipt$/, showReceipt),
  route(/^\/api\/sessions\/([^/]+)\/call$/, callStaff),
]

export default defineHandler((event) => {
  const url = new URL(event.req.url)
  for (const entry of routes) {
    const match = entry.pattern.exec(url.pathname)
    if (match) {
      return entry.handler({
        request: event.req,
        params: { id: match[1] ? decodeURIComponent(match[1]) : undefined },
      })
    }
  }
  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  })
})
