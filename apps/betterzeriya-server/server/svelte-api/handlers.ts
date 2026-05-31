import {
  callOfficialStaff,
  createOfficialSession,
  getOfficialAccount,
  getOfficialState,
  lookupOfficialItem,
  parseOfficialSessionSnapshot,
  serializeState,
  setOfficialPeopleCount,
  showOfficialReceipt,
  submitOfficialCart,
} from '../lib/official-client.ts'
import {
  getSessionOrderAttributions,
  normalizeRoomHash,
  recordSessionOrder,
  setSessionDeviceName,
} from '../lib/session-model-store.ts'

type HandlerInput = {
  request: Request
  params?: Record<string, string | undefined>
}

const json = (data: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  })

const readJSON = async (request: Request) => request.json().catch(() => ({}))

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback

const roomHashFromSnapshot = (snapshot: ReturnType<typeof parseOfficialSessionSnapshot>) => {
  const roomHash = normalizeRoomHash(snapshot?.roomHash)
  if (!roomHash) {
    throw new Error('Session room is invalid')
  }
  return roomHash
}

const enrichCheckout = async <
  T extends { officialSession?: ReturnType<typeof parseOfficialSessionSnapshot> },
>(
  checkout: T,
) => {
  const roomHash = roomHashFromSnapshot(checkout.officialSession)
  return {
    ...checkout,
    orderAttributions: await getSessionOrderAttributions(roomHash),
  }
}

export const createSession = async ({ request }: HandlerInput) => {
  const body = await readJSON(request)
  const qrURLSource = String(body.qrURLSource ?? '').trim()

  if (!URL.canParse(qrURLSource)) {
    return json({ error: 'QR URL is invalid' }, { status: 400 })
  }

  try {
    const session = await createOfficialSession(qrURLSource)
    return json({
      id: session.id,
      state: serializeState(session.state),
      officialSession: session.officialSession,
    })
  } catch (error) {
    return json({ error: errorMessage(error, 'Failed to start session') }, { status: 502 })
  }
}

export const getSession = async ({ params, request }: HandlerInput) => {
  try {
    const body = await readJSON(request)
    const result = await getOfficialState(
      params?.id ?? '',
      parseOfficialSessionSnapshot(body.officialSession),
    )
    return json({ state: serializeState(result.state), officialSession: result.officialSession })
  } catch (error) {
    return json({ error: errorMessage(error, 'Session not found') }, { status: 404 })
  }
}

export const setPeopleCount = async ({ params, request }: HandlerInput) => {
  const body = await readJSON(request)
  const peopleCount = Number(body.peopleCount)

  if (!Number.isInteger(peopleCount) || peopleCount < 1 || peopleCount > 99) {
    return json({ error: 'People count must be between 1 and 99' }, { status: 400 })
  }

  try {
    const result = await setOfficialPeopleCount(
      params?.id ?? '',
      peopleCount,
      parseOfficialSessionSnapshot(body.officialSession),
    )
    return json({ state: serializeState(result.state), officialSession: result.officialSession })
  } catch (error) {
    return json({ error: errorMessage(error, 'Failed to set people count') }, { status: 502 })
  }
}

export const lookupItem = async ({ params, request }: HandlerInput) => {
  const body = await readJSON(request)
  const code = String(body.code ?? '').trim()

  if (!/^\d{4}$/.test(code)) {
    return json({ error: 'Item code must be 4 digits' }, { status: 400 })
  }

  try {
    const result = await lookupOfficialItem(
      params?.id ?? '',
      code,
      parseOfficialSessionSnapshot(body.officialSession),
    )
    return json({ ...result.result, officialSession: result.officialSession })
  } catch (error) {
    return json({ error: errorMessage(error, 'Failed to lookup item') }, { status: 502 })
  }
}

export const submitOrder = async ({ params, request }: HandlerInput) => {
  const body = await readJSON(request)
  const cart = Array.isArray(body.cart) ? body.cart : []

  if (cart.length === 0) {
    return json({ error: 'Cart is empty' }, { status: 400 })
  }

  const normalizedCart = []
  for (const item of cart) {
    const id = String(item.id ?? '').trim()
    const count = Number(item.count ?? 1)
    if (!/^\d{4}$/.test(id)) {
      return json({ error: 'Item code must be 4 digits' }, { status: 400 })
    }
    if (!Number.isInteger(count) || count < 1 || count > 99) {
      return json({ error: 'Count must be between 1 and 99' }, { status: 400 })
    }
    normalizedCart.push({ id, count, name: item.name })
  }

  try {
    const officialSession = parseOfficialSessionSnapshot(body.officialSession)
    const roomHash = roomHashFromSnapshot(officialSession)
    const result = await submitOfficialCart(params?.id ?? '', normalizedCart, officialSession)
    await recordSessionOrder({
      roomHash,
      deviceToken: body.deviceToken,
      lines: normalizedCart.map((item) => ({
        code: item.id,
        count: item.count,
        ...(item.name ? { name: String(item.name).slice(0, 100) } : {}),
      })),
    })
    return json({
      state: serializeState(result.state),
      officialSession: result.officialSession,
      orderAttributions: await getSessionOrderAttributions(roomHash),
    })
  } catch (error) {
    return json({ error: errorMessage(error, 'Failed to submit order') }, { status: 502 })
  }
}

export const setDeviceName = async ({ request }: HandlerInput) => {
  const body = await readJSON(request)
  const officialSession = parseOfficialSessionSnapshot(body.officialSession)

  try {
    const name = await setSessionDeviceName({
      roomHash: roomHashFromSnapshot(officialSession),
      deviceToken: body.deviceToken,
      name: body.name,
    })
    return json({ name })
  } catch (error) {
    return json({ error: errorMessage(error, 'Failed to set device name') }, { status: 400 })
  }
}

export const getAccount = async ({ params, request }: HandlerInput) => {
  try {
    const body = await readJSON(request)
    return json(
      await enrichCheckout(
        await getOfficialAccount(
          params?.id ?? '',
          parseOfficialSessionSnapshot(body.officialSession),
        ),
      ),
    )
  } catch (error) {
    return json({ error: errorMessage(error, 'Failed to load account') }, { status: 502 })
  }
}

export const showReceipt = async ({ params, request }: HandlerInput) => {
  try {
    const body = await readJSON(request)
    return json(
      await enrichCheckout(
        await showOfficialReceipt(
          params?.id ?? '',
          parseOfficialSessionSnapshot(body.officialSession),
        ),
      ),
    )
  } catch (error) {
    return json({ error: errorMessage(error, 'Failed to show receipt') }, { status: 502 })
  }
}

export const callStaff = async ({ params, request }: HandlerInput) => {
  try {
    const body = await readJSON(request)
    return json(
      await callOfficialStaff(
        params?.id ?? '',
        Boolean(body.after),
        parseOfficialSessionSnapshot(body.officialSession),
      ),
    )
  } catch (error) {
    return json({ error: errorMessage(error, 'Failed to call staff') }, { status: 502 })
  }
}
