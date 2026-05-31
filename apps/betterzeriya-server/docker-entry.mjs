import http from 'node:http'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

const firstExisting = (...paths) => paths.find((path) => existsSync(path)) ?? paths[0]

const publicPort = Number(process.env.PORT ?? 3000)
const sveltePort = Number(process.env.SVELTE_PORT ?? 3001)
const apiPort = Number(process.env.API_PORT ?? 3002)
const svelteEntry =
  process.env.SVELTE_ENTRY ?? firstExisting('betterzeriya-build', 'apps/betterzeriya/build')
const apiEntry =
  process.env.API_ENTRY ??
  firstExisting(
    'betterzeriya-server-output/server/index.mjs',
    'apps/betterzeriya-server/.output/server/index.mjs',
  )

const start = (name, command, args, env) => {
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  child.on('exit', (code, signal) => {
    console.error(`${name} exited`, { code, signal })
    process.exit(code ?? 1)
  })
  return child
}

const proxyRequest = (targetPort, request, response) => {
  const proxy = http.request(
    {
      hostname: '127.0.0.1',
      port: targetPort,
      method: request.method,
      path: request.url,
      headers: request.headers,
    },
    (upstream) => {
      response.writeHead(upstream.statusCode ?? 502, upstream.statusMessage, upstream.headers)
      upstream.pipe(response)
    },
  )
  proxy.on('error', (error) => {
    response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    response.end(`Bad Gateway: ${error.message}`)
  })
  request.pipe(proxy)
}

const proxyUpgrade = (targetPort, request, socket, head) => {
  const upstream = net.connect(targetPort, '127.0.0.1')
  upstream.on('connect', () => {
    upstream.write(
      [
        `${request.method} ${request.url} HTTP/${request.httpVersion}`,
        ...Object.entries(request.headers).map(([name, value]) =>
          Array.isArray(value) ? `${name}: ${value.join(', ')}` : `${name}: ${value ?? ''}`,
        ),
        '',
        '',
      ].join('\r\n'),
    )
    if (head.length) {
      upstream.write(head)
    }
    upstream.pipe(socket)
    socket.pipe(upstream)
  })
  upstream.on('error', () => socket.destroy())
}

start('betterzeriya', 'node', [svelteEntry], {
  HOST: '127.0.0.1',
  PORT: String(sveltePort),
})
start('betterzeriya-server', 'node', [apiEntry], {
  HOST: '127.0.0.1',
  PORT: String(apiPort),
})

const server = http.createServer((request, response) => {
  const targetPort = request.url?.startsWith('/api') ? apiPort : sveltePort
  proxyRequest(targetPort, request, response)
})

server.on('upgrade', (request, socket, head) => {
  const targetPort = request.url?.startsWith('/api') ? apiPort : sveltePort
  proxyUpgrade(targetPort, request, socket, head)
})

server.listen(publicPort, '0.0.0.0', () => {
  console.log(`betterzeriya listening on http://0.0.0.0:${publicPort}`)
})
