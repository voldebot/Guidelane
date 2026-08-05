import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { lstat, open, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, relative, resolve } from 'node:path'
import type { Duplex } from 'node:stream'
import { trustedCallerDirectory } from './artifacts.ts'
import { Orchestrator } from './orchestrator.ts'

const hash = (value: string): Buffer => createHash('sha256').update(value).digest()
const cookie = (request: IncomingMessage, name: string): string | null => request.headers.cookie?.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1) ?? null
const body = async (request: IncomingMessage): Promise<unknown> => { let text = ''; for await (const chunk of request) { text += chunk; if (text.length > 65_536) throw new Error('body too large') } return JSON.parse(text) as unknown }
const sendFrame = (socket: { write(data: Uint8Array): boolean; destroyed: boolean }, value: unknown): void => { const payload = Buffer.from(JSON.stringify(value), 'utf8'); if (payload.length >= 126) throw new Error('semantic event too large'); socket.write(Buffer.concat([Buffer.from([0x81, payload.length]), payload])) }
const staticContentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'"
export interface LoopbackOptions { orchestrator: Orchestrator; port?: number; launchToken?: string; launchTokenTtlMs?: number; sessionIdleMs?: number; sessionAbsoluteMs?: number; cockpitRoot?: string }
const staticHeaders = (response: ServerResponse, index: boolean, extension: string): void => {
  response.setHeader('content-security-policy', staticContentSecurityPolicy)
  response.setHeader('x-content-type-options', 'nosniff'); response.setHeader('referrer-policy', 'no-referrer')
  response.setHeader('cache-control', index ? 'no-store' : 'public, max-age=31536000, immutable')
  const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }
  response.setHeader('content-type', types[extension] ?? 'application/octet-stream')
}
const staticPath = (root: string, rawUrl: string): { path: string; index: boolean } | null => {
  const rawPath = rawUrl.split('?')[0] ?? '/'
  if (/%2e|%2f|%5c/i.test(rawPath)) return null
  const rawSegments = rawPath.split('/').filter(Boolean)
  if (rawSegments.some((part) => part === '.' || part === '..' || part.startsWith('.'))) return null
  const name = rawSegments.length === 0 ? 'index.html' : rawSegments.join('/')
  const candidate = resolve(root, name)
  if (relative(root, candidate).startsWith('..')) return null
  return { path: candidate, index: name === 'index.html' }
}
const privateStaticRoot = async (value: string): Promise<string | null> => {
  try { return await trustedCallerDirectory(value, { create: false, label: 'cockpit static root' }) } catch { return null }
}
const staticBytes = async (root: string, path: string): Promise<Buffer | null> => {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const info = await handle.stat()
    if (!info.isFile()) return null
    // The descriptor identity, not a pre-open pathname resolution, is the
    // authority for this read. Platforms that cannot resolve it fail closed.
    let opened: string
    try {
      opened = await realpath(`/dev/fd/${handle.fd}`)
      if (opened.startsWith('/dev/fd/')) throw new Error('descriptor path cannot be resolved')
    } catch {
      // Darwin does not always expose descriptor links. Confirm that the
      // descriptor is still the object named by the post-open path, then
      // resolve that name; no pathname is ever read before this check.
      const named = await lstat(path)
      if (named.dev !== info.dev || named.ino !== info.ino) return null
      opened = await realpath(path)
    }
    if (relative(root, opened).startsWith('..') || opened === root) return null
    return await handle.readFile()
  } catch { return null } finally { await handle?.close() }
}
/** Construct a fragment-only cockpit launch URL without opening a browser. */
export function launchUrl(origin: string, token: string): string {
  if (!/^[a-f0-9]{32}$/i.test(token)) throw new Error('launch token must be 128 bits')
  let parsed: URL; try { parsed = new URL(origin) } catch { throw new Error('invalid loopback origin') }
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || !parsed.port || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('origin must be an exact 127.0.0.1 loopback origin')
  const port = Number(parsed.port); if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('invalid loopback origin port')
  return `${parsed.origin}/#launchToken=${encodeURIComponent(token)}`
}
export async function createLoopbackServer(options: LoopbackOptions): Promise<{ origin: string; close(): Promise<void> }> {
  const token = options.launchToken ?? randomBytes(16).toString('hex'); if (!/^[a-f0-9]{32}$/i.test(token)) throw new Error('launch token must be 128 bits')
  const verifier = hash(token); const expiresAt = Date.now() + (options.launchTokenTtlMs ?? 5 * 60_000); let used = false; let projectCreated = false; let origin = ''
  const webSockets = new Set<Duplex>()
  const sessions = new Map<string, { created: number; touched: number }>()
  const cockpitRoot = options.cockpitRoot ? await privateStaticRoot(options.cockpitRoot) : null
  const hostMatches = (request: IncomingMessage): boolean => request.headers.host === new URL(origin).host
  const exact = (request: IncomingMessage): boolean => hostMatches(request) && request.headers.origin === origin
  const authenticated = (request: IncomingMessage, allowMissingOrigin = false): boolean => {
    if (!hostMatches(request) || (request.headers.origin !== origin && !(allowMissingOrigin && request.headers.origin === undefined))) return false
    const id = cookie(request, 'guidelane_session'); const session = id ? sessions.get(id) : undefined; const now = Date.now()
    if (!session || now - session.touched > (options.sessionIdleMs ?? 30 * 60_000) || now - session.created > (options.sessionAbsoluteMs ?? 8 * 60 * 60_000)) { if (id) sessions.delete(id); return false }
    session.touched = now; return true
  }
  const sessionStillValid = (id: string): boolean => {
    const session = sessions.get(id)
    const now = Date.now()
    if (!session || now - session.touched > (options.sessionIdleMs ?? 30 * 60_000) || now - session.created > (options.sessionAbsoluteMs ?? 8 * 60 * 60_000)) {
      sessions.delete(id)
      return false
    }
    return true
  }
  const reply = (response: ServerResponse, status: number, value?: unknown): void => { response.statusCode = status; if (value !== undefined) { response.setHeader('content-type', 'application/json; charset=utf-8'); response.end(JSON.stringify(value)) } else response.end() }
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url ?? '/', origin).pathname
      if (path === '/api/v1/health') return reply(response, 200, { ok: true })
      if (cockpitRoot && !path.startsWith('/api/') && request.method === 'GET') {
        const file = staticPath(cockpitRoot, request.url ?? '/')
        if (!file) return reply(response, 404)
        const bytes = await staticBytes(cockpitRoot, file.path)
        if (!bytes) return reply(response, 404)
        staticHeaders(response, file.index, extname(file.path)); response.statusCode = 200; response.end(bytes); return
      }
      if (!path.startsWith('/api/')) return reply(response, 404)
      if (path === '/api/v1/session' && request.method === 'POST') {
        if (!exact(request)) return reply(response, 403); const value = await body(request) as { launchToken?: unknown }
        // Node handles each handler serially, but consume before awaiting any
        // further operation so concurrent exchanges have exactly one winner.
        if (used || Date.now() > expiresAt || typeof value.launchToken !== 'string' || value.launchToken.length !== token.length || !timingSafeEqual(verifier, hash(value.launchToken))) return reply(response, 401)
        used = true; const id = randomBytes(32).toString('hex'); sessions.set(id, { created: Date.now(), touched: Date.now() }); response.setHeader('set-cookie', `guidelane_session=${id}; HttpOnly; SameSite=Strict; Path=/`); return reply(response, 204)
      }
      // Chromium omits Origin on same-origin, read-only fetches. This is the
      // sole compatibility exception: an Origin that is present stays exact.
      if (path === '/api/v1/projects/current' && request.method === 'GET') {
        if (!hostMatches(request) || (request.headers.origin !== undefined && request.headers.origin !== origin)) return reply(response, 403)
        if (!authenticated(request, true)) return reply(response, 401)
        response.setHeader('cache-control', 'no-store')
        return reply(response, 200, await options.orchestrator.publicSnapshot())
      }
      if (!exact(request)) return reply(response, 403)
      if (!authenticated(request)) return reply(response, 401)
      if (path === '/api/v1/projects' && request.method === 'POST') { if (projectCreated) return reply(response, 409); projectCreated = true; return reply(response, 201) }
      if (path === '/api/v1/projects/current/commands' && request.method === 'POST') { await options.orchestrator.command(await body(request)); return reply(response, 204) }
      return reply(response, 404)
    } catch { return reply(response, 400) }
  })
  server.on('upgrade', (request, socket) => {
    const fail = (status: number): void => { socket.end(`HTTP/1.1 ${status} ${status === 403 ? 'Forbidden' : 'Unauthorized'}\r\nConnection: close\r\n\r\n`) }
    if (new URL(request.url ?? '/', origin).pathname !== '/api/v1/events') return fail(403)
    if (!exact(request)) return fail(403)
    if (!authenticated(request)) return fail(401)
    const upgradeUrl = new URL(request.url ?? '/', origin)
    const values = upgradeUrl.searchParams.getAll('afterRevision')
    if (values.length > 1 || (values.length === 1 && (!/^\d+$/.test(values[0]!) || !Number.isSafeInteger(Number(values[0]!))))) return fail(403)
    const afterRevision = values.length === 1 ? Number(values[0]) : undefined
    const sessionId = cookie(request, 'guidelane_session')!
    const key = request.headers['sec-websocket-key']; if (typeof key !== 'string') return fail(403)
    const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
    // Deliberately ignore all inbound frames: this endpoint is event-only.
    socket.on('data', () => undefined)
    let unsubscribed = false
    const buffered: Array<{ type: 'phase_update'; revision: number; message: string }> = []
    let live = false
    const sendIfNew = (event: { type: 'phase_update'; revision: number; message: string }, sent: Set<number>): void => {
      if (sent.has(event.revision)) return
      sent.add(event.revision)
      if (!socket.destroyed) sendFrame(socket, event)
    }
    const unsubscribe = options.orchestrator.subscribe((event) => {
      if (!sessionStillValid(sessionId)) { closeSocket(); socket.destroy(); return }
      if (!live) { buffered.push(event); return }
      if (!socket.destroyed) sendFrame(socket, event)
    })
    webSockets.add(socket)
    const closeSocket = (): void => {
      webSockets.delete(socket)
      if (!unsubscribed) { unsubscribed = true; unsubscribe() }
    }
    socket.once('close', closeSocket); socket.once('error', closeSocket)
    void (async () => {
      const sent = new Set<number>()
      if (afterRevision !== undefined) {
        const history = await options.orchestrator.eventsSince(afterRevision)
        if (history.kind === 'events') for (const event of history.events) sendIfNew(event, sent)
        else sendFrame(socket, { type: 'snapshot_required' })
      }
      const floor = afterRevision ?? -1
      for (const event of buffered.sort((left, right) => left.revision - right.revision)) if (event.revision > floor) sendIfNew(event, sent)
      live = true
    })().catch(() => { closeSocket(); socket.destroy() })
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, '127.0.0.1', () => resolve()) })
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { origin, close: () => new Promise((resolve, reject) => { for (const socket of webSockets) socket.destroy(); server.close((error) => error ? reject(error) : resolve()) }) }
}
