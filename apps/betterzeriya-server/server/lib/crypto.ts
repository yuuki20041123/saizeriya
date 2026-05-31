const textEncoder = new TextEncoder()

export const bytesToHex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')

export const sha256Hex = async (value: string) =>
  bytesToHex(await crypto.subtle.digest('SHA-256', textEncoder.encode(value)))

export const hashInitialURL = sha256Hex
