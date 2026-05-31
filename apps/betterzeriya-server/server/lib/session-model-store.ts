import { useStorage } from 'nitro/storage'
import { sha256Hex } from './crypto.ts'

const SESSION_TTL_SECONDS = 24 * 60 * 60
const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000

type StoredDevice = {
  type: 'device'
  tokenHash: string
  name?: string
  updatedAt: string
}

type StoredOrder = {
  type: 'order'
  tokenHash: string
  orderedAt: string
  lines: OrderAttributionLine[]
}

type SessionStorageValue = StoredDevice | StoredOrder

export type OrderAttributionLine = {
  code: string
  count: number
  name?: string
}

export type OrderAttribution = {
  name?: string
  orderedAt: string
  lines: OrderAttributionLine[]
}

export const normalizeRoomHash = (hash: unknown) => {
  const trimmed = String(hash ?? '')
    .trim()
    .toLowerCase()
  return /^[a-f0-9]{64}$/.test(trimmed) ? trimmed : undefined
}

export const normalizeDeviceToken = (token: unknown) => {
  const trimmed = String(token ?? '').trim()
  return /^[A-Za-z0-9_-]{32,180}$/.test(trimmed) ? trimmed : undefined
}

export const normalizeUserName = (name: unknown) => {
  const trimmed = String(name ?? '').trim()
  return trimmed ? trimmed.slice(0, 40) : undefined
}

const sessionStorage = () => useStorage<SessionStorageValue>('session-model')

const tokenHashForRoom = (roomHash: string, token: string) => sha256Hex(`${roomHash}:${token}`)

const sessionPrefix = (roomHash: string) => `sessions/${roomHash}`
const deviceKey = (roomHash: string, tokenHash: string) =>
  `${sessionPrefix(roomHash)}/devices/${tokenHash}`
const orderKey = (roomHash: string, orderedAt: string, id: string) =>
  `${sessionPrefix(roomHash)}/orders/${orderedAt}-${id}`

const valueTime = (value: SessionStorageValue) =>
  value.type === 'device' ? value.updatedAt : value.orderedAt

const isFresh = (value: SessionStorageValue, now = Date.now()) => {
  const timestamp = Date.parse(valueTime(value))
  return Number.isFinite(timestamp) && timestamp > now - SESSION_TTL_MS
}

const pruneKeys = async (keys: string[]) => {
  const storage = sessionStorage()
  const now = Date.now()
  await Promise.all(
    keys.map(async (key) => {
      const value = await storage.getItem(key)
      if (!value || !isFresh(value, now)) {
        await storage.removeItem(key)
      }
    }),
  )
}

export const pruneSessionModel = async () => {
  await pruneKeys(await sessionStorage().getKeys('sessions'))
}

export const setSessionDeviceName = async (input: {
  roomHash: string
  deviceToken: unknown
  name: unknown
}) => {
  const deviceToken = normalizeDeviceToken(input.deviceToken)
  if (!deviceToken) {
    throw new Error('Device token is invalid')
  }

  const tokenHash = await tokenHashForRoom(input.roomHash, deviceToken)
  const device: StoredDevice = {
    type: 'device',
    tokenHash,
    ...(normalizeUserName(input.name) ? { name: normalizeUserName(input.name) } : {}),
    updatedAt: new Date().toISOString(),
  }
  await sessionStorage().setItem(deviceKey(input.roomHash, tokenHash), device, {
    ttl: SESSION_TTL_SECONDS,
  })
  return device.name ?? ''
}

export const recordSessionOrder = async (input: {
  roomHash: string
  deviceToken: unknown
  lines: OrderAttributionLine[]
}) => {
  const deviceToken = normalizeDeviceToken(input.deviceToken)
  if (!deviceToken) {
    throw new Error('Device token is invalid')
  }

  const orderedAt = new Date().toISOString()
  const tokenHash = await tokenHashForRoom(input.roomHash, deviceToken)
  const order: StoredOrder = {
    type: 'order',
    tokenHash,
    orderedAt,
    lines: input.lines,
  }
  await sessionStorage().setItem(orderKey(input.roomHash, orderedAt, crypto.randomUUID()), order, {
    ttl: SESSION_TTL_SECONDS,
  })
  return order
}

export const getSessionOrderAttributions = async (roomHash: string) => {
  const storage = sessionStorage()
  const keys = await storage.getKeys(sessionPrefix(roomHash))
  await pruneKeys(keys)

  const freshKeys = await storage.getKeys(sessionPrefix(roomHash))
  const values = await Promise.all(freshKeys.map((key) => storage.getItem(key)))
  const devices = new Map<string, string>()
  const orders: StoredOrder[] = []

  for (const value of values) {
    if (!value) {
      continue
    }
    if (value.type === 'device') {
      devices.set(value.tokenHash, value.name ?? '')
    } else {
      orders.push(value)
    }
  }

  return orders
    .sort((left, right) => left.orderedAt.localeCompare(right.orderedAt))
    .map(
      (order): OrderAttribution => ({
        ...(devices.get(order.tokenHash) ? { name: devices.get(order.tokenHash) } : {}),
        orderedAt: order.orderedAt,
        lines: order.lines,
      }),
    )
}
