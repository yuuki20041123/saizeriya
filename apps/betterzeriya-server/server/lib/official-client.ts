import {
  createClient,
  type AccountSummary,
  type ClientState,
  type LookupItemResult,
} from 'saizeriya.js'
import { hashInitialURL } from './crypto.ts'

type OfficialClient = Awaited<ReturnType<typeof createClient>>
type BrowserOfficialClient = Awaited<
  ReturnType<typeof import('saizeriya.js/browser-mode').createBrowserClient>
>
type AnyOfficialClient = OfficialClient | BrowserOfficialClient
type FetchSource = (request: Request) => Promise<Response> | Response
type CookieEntry = [string, string]

export interface CheckoutPresentation {
  state: ReturnType<typeof serializeState>
  account: AccountSummary
  barcodeValue: string
  barcodeImageSrc?: string
  receiptShown: boolean
}

export interface PendingCartItem {
  id: string
  count: number
}

export interface OfficialSessionSnapshot {
  id: string
  state: ClientState
  cookies: CookieEntry[]
  roomHash?: string
  mode?: 'fetch' | 'browser'
  createdAt: number
  updatedAt: number
}

interface BrowserSessionRecord {
  client: BrowserOfficialClient
  roomHash: string
  close?: () => Promise<void>
  createdAt: number
  updatedAt: number
}

const browserSessions = new Map<string, BrowserSessionRecord>()
const sessionTtlMs = 1000 * 60 * 60 * 6
const useBrowserMode = () => process.env.BROWSER === '1'
const browserLaunchOptions = () => ({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}),
})

const pruneSessions = () => {
  const now = Date.now()
  for (const [id, session] of browserSessions) {
    if (now - session.updatedAt > sessionTtlMs) {
      void session.close?.()
      browserSessions.delete(id)
    }
  }
}

const cookieHeader = (cookies: Map<string, string>) =>
  [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ')

const storeSetCookie = (cookies: Map<string, string>, response: Response) => {
  const setCookie = response.headers.get('set-cookie')
  if (!setCookie) {
    return
  }

  for (const cookie of setCookie.split(/,(?=\s*[^;,\s]+=)/)) {
    const [pair] = cookie.split(';')
    const separator = pair.indexOf('=')
    if (separator > 0) {
      cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim())
    }
  }
}

const createCookieFetch = (initialCookies: CookieEntry[] = []) => {
  const cookies = new Map<string, string>(initialCookies)

  const fetchSource: FetchSource = async (request) => {
    const headers = new Headers(request.headers)
    const currentCookies = cookieHeader(cookies)
    if (currentCookies) {
      headers.set('cookie', currentCookies)
    }

    const response = await fetch(new Request(request, { headers }))
    storeSetCookie(cookies, response)
    return response
  }

  return {
    fetchSource,
    getCookies: () => [...cookies.entries()] as CookieEntry[],
  }
}

const touchBrowserSession = (id: string, session: BrowserSessionRecord) => {
  session.updatedAt = Date.now()
  browserSessions.set(id, session)
  return session
}

export const createOfficialSession = async (qrURLSource: string) => {
  pruneSessions()
  const id = crypto.randomUUID()
  const now = Date.now()
  const roomHash = await hashInitialURL(qrURLSource)

  if (useBrowserMode()) {
    const { createBrowserClient } = await import('saizeriya.js/browser-mode')
    const client = await createBrowserClient({
      qrURLSource,
      launchOptions: browserLaunchOptions(),
    })
    const session: BrowserSessionRecord = {
      client,
      roomHash,
      close: () => client.close(),
      createdAt: now,
      updatedAt: now,
    }
    browserSessions.set(id, session)
    return {
      id,
      state: client.getState(),
      officialSession: createSnapshot(id, client, [], now, 'browser', roomHash),
    }
  }

  const cookieFetch = createCookieFetch()
  const client = await createClient({
    qrURLSource,
    fetchSource: cookieFetch.fetchSource,
  })
  return {
    id,
    state: client.getState(),
    officialSession: createSnapshot(id, client, cookieFetch.getCookies(), now, 'fetch', roomHash),
  }
}

export const getBrowserSession = (id: string) => {
  pruneSessions()
  const session = browserSessions.get(id)
  if (!session) {
    throw new Error('Session not found')
  }
  return touchBrowserSession(id, session)
}

const createSnapshot = (
  id: string,
  client: AnyOfficialClient,
  cookies: CookieEntry[],
  createdAt = Date.now(),
  mode: 'fetch' | 'browser' = 'fetch',
  roomHash?: string,
): OfficialSessionSnapshot => ({
  id,
  state: client.getState(),
  cookies,
  ...(roomHash ? { roomHash } : {}),
  mode,
  createdAt,
  updatedAt: Date.now(),
})

export const parseOfficialSessionSnapshot = (
  value: unknown,
): OfficialSessionSnapshot | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const snapshot = value as OfficialSessionSnapshot
  if (!snapshot.id || !snapshot.state?.baseURL || !Array.isArray(snapshot.cookies)) {
    return undefined
  }
  return snapshot
}

const createClientFromSnapshot = async (id: string, snapshot?: OfficialSessionSnapshot) => {
  if (useBrowserMode()) {
    const session = getBrowserSession(id)
    return {
      client: session.client,
      getSnapshot: () =>
        createSnapshot(id, session.client, [], session.createdAt, 'browser', session.roomHash),
    }
  }

  if (snapshot?.id !== id) {
    throw new Error('Session snapshot not found')
  }

  const cookieFetch = createCookieFetch(snapshot.cookies)
  const client = await createClient({
    initialState: snapshot.state,
    fetchSource: cookieFetch.fetchSource,
  })
  return {
    client,
    getSnapshot: () =>
      createSnapshot(
        id,
        client,
        cookieFetch.getCookies(),
        snapshot.createdAt,
        'fetch',
        snapshot.roomHash,
      ),
  }
}

export const setOfficialPeopleCount = async (
  id: string,
  peopleCount: number,
  snapshot?: OfficialSessionSnapshot,
) => {
  const session = await createClientFromSnapshot(id, snapshot)
  const state = await session.client.setPeopleCount(peopleCount)
  return { state, officialSession: session.getSnapshot() }
}

export const serializeState = (state: ClientState) => ({
  ...state,
  baseURL: undefined,
})

export const lookupOfficialItem = async (
  id: string,
  code: string,
  snapshot?: OfficialSessionSnapshot,
): Promise<{ result: LookupItemResult; officialSession: OfficialSessionSnapshot }> => {
  const session = await createClientFromSnapshot(id, snapshot)
  const result = await session.client.lookupItem(code)
  return { result, officialSession: session.getSnapshot() }
}

export const submitOfficialCart = async (
  id: string,
  cart: PendingCartItem[],
  snapshot?: OfficialSessionSnapshot,
) => {
  const session = await createClientFromSnapshot(id, snapshot)
  while (session.client.getState().cart.length > 0) {
    await session.client.removeCartItem(0)
  }
  for (const item of cart) {
    await session.client.addItem(item.id, { count: item.count })
  }
  const state = await session.client.submitOrder()
  return { state, officialSession: session.getSnapshot() }
}

const createCheckoutCode = (state: ClientState, account: AccountSummary) =>
  [
    'SZ',
    state.shopId.toString().padStart(4, '0'),
    state.tableNo.toString().padStart(3, '0'),
    account.controlNo ?? state.sessionId ?? state.nextId,
  ].join('-')

export const getOfficialAccount = async (
  id: string,
  snapshot?: OfficialSessionSnapshot,
): Promise<CheckoutPresentation & { officialSession: OfficialSessionSnapshot }> => {
  const session = await createClientFromSnapshot(id, snapshot)
  const result = await session.client.getAccount()
  return {
    state: serializeState(result.state),
    account: result.account,
    barcodeValue: createCheckoutCode(result.state, result.account),
    receiptShown: false,
    officialSession: session.getSnapshot(),
  }
}

export const showOfficialReceipt = async (
  id: string,
  snapshot?: OfficialSessionSnapshot,
): Promise<CheckoutPresentation & { officialSession: OfficialSessionSnapshot }> => {
  const session = await createClientFromSnapshot(id, snapshot)
  const accountResult = await session.client.getAccount()
  const receiptResult = await session.client.getReceipt()
  return {
    state: serializeState(receiptResult.state),
    account: accountResult.account,
    barcodeValue:
      receiptResult.receipt.barcodeValue ??
      createCheckoutCode(receiptResult.state, accountResult.account),
    barcodeImageSrc: receiptResult.receipt.barcodeImageSrc,
    receiptShown: true,
    officialSession: session.getSnapshot(),
  }
}

export const callOfficialStaff = async (
  id: string,
  after: boolean,
  snapshot?: OfficialSessionSnapshot,
) => {
  const session = await createClientFromSnapshot(id, snapshot)
  const result = after ? await session.client.callDessert() : await session.client.callStaff()
  return { result, officialSession: session.getSnapshot() }
}

export const getOfficialState = async (id: string, snapshot?: OfficialSessionSnapshot) => {
  const session = await createClientFromSnapshot(id, snapshot)
  return { state: session.client.getState(), officialSession: session.getSnapshot() }
}
