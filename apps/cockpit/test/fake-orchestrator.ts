import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, normalize, resolve } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'

export type FakeRunState = 'idle' | 'waiting' | 'running' | 'retrying' | 'stopped' | 'interrupted' | 'needs-user' | 'rate-limit' | 'recovery-required' | 'successful'
export type FakeCommand = 'submitIdea' | 'approveBlueprint' | 'requestBlueprintChange' | 'approvePlan' | 'startBuild' | 'acceptResult' | 'requestChange' | 'rollback'

export interface FakeSnapshot {
  schemaVersion: 1
  projectId: 'cockpit-novice'
  revision: number
  stage: string
  runState: FakeRunState
  language: 'tr' | 'en'
  blueprintRevision: number
  gates: Array<{ name: string; status: string; authority: 'machine' | 'user' | 'isolated_review'; verified: boolean }>
  pendingDecision: string | null
}

export interface LoggedRequest { method: string; path: string; host?: string; origin?: string }

const TOKEN = '0123456789abcdef0123456789abcdef'
const COOKIE = 'guidelane_session=fake-session-0000000000000000000000000000000000000000000000000000000000000000'
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' }

const initial = (): FakeSnapshot => ({
  schemaVersion: 1,
  projectId: 'cockpit-novice',
  revision: 0,
  stage: 'G0',
  runState: 'idle',
  language: 'tr',
  blueprintRevision: 0,
  gates: [],
  pendingDecision: 'submitIdea',
})

const requiredMachineGates = ['lint', 'type', 'unit', 'build', 'boot', 'axe', 'smoke'] as const
const completedMachineGates = (): FakeSnapshot['gates'] => requiredMachineGates.map((name) => ({
  name,
  status: 'passed',
  authority: 'machine',
  verified: true,
}))

const readBody = async (request: AsyncIterable<Uint8Array>): Promise<unknown> => {
  let text = ''
  for await (const chunk of request) text += Buffer.from(chunk).toString('utf8')
  return JSON.parse(text) as unknown
}

const isSafeAssetPath = (root: string, requestPath: string): string | null => {
  const wanted = requestPath === '/' ? '/index.html' : requestPath
  const target = resolve(root, `.${normalize(wanted)}`)
  return target.startsWith(`${root}/`) || target === root ? target : null
}

export interface FakeCockpitServer {
  origin: string
  launchToken: string
  snapshot(): FakeSnapshot
  setRunState(state: FakeRunState): void
  emitWebSocketEvent(event: unknown): void
  requests(): readonly LoggedRequest[]
  close(): Promise<void>
}

/** Test-owned same-origin server; it never spawns an engine or contacts a network. */
export async function createFakeCockpitServer(assetDirectory: string): Promise<FakeCockpitServer> {
  const assets = resolve(assetDirectory)
  let snapshot = initial()
  let tokenUsed = false
  let projectCreated = false
  let closing = false
  let closePromise: Promise<void> | null = null
  let origin = ''
  const requests: LoggedRequest[] = []
  const sockets = new Set<Duplex>()
  const listeners = new Set<(event: unknown) => void>()

  const semantic = (message: string): void => {
    const event = { type: 'phase_update' as const, revision: snapshot.revision, message }
    for (const listener of listeners) listener(event)
  }
  const set = (next: Partial<FakeSnapshot>, message: string): void => {
    snapshot = { ...snapshot, ...next, revision: snapshot.revision + 1 }
    semantic(message)
  }
  const command = (value: unknown): void => {
    const type = typeof value === 'object' && value !== null ? (value as { type?: unknown }).type : undefined
    if (typeof type !== 'string') throw new Error('invalid command')
    const transitions: Record<FakeCommand, () => void> = {
      submitIdea: () => set({ stage: 'G1', runState: 'waiting', pendingDecision: 'approveBlueprint', blueprintRevision: 1 }, 'Taslak hazır; onayınızı bekliyor.'),
      approveBlueprint: () => set({ stage: 'G2', runState: 'waiting', pendingDecision: 'approvePlan' }, 'Plan hazır; onayınızı bekliyor.'),
      requestBlueprintChange: () => set({ stage: 'G1', runState: 'needs-user', pendingDecision: 'submitIdea' }, 'Taslak değişikliği bekleniyor.'),
      approvePlan: () => set({ stage: 'G3', runState: 'waiting', pendingDecision: 'startBuild' }, 'İnşa başlatılmaya hazır.'),
      startBuild: () => {
        set({ stage: 'G4', runState: 'running', pendingDecision: null }, 'İnşa güvenle ilerliyor.')
        setTimeout(() => set({ stage: 'G5', runState: 'waiting', pendingDecision: 'acceptResult', gates: completedMachineGates() }, 'Kontroller tamamlandı; sonucu inceleyin.'), 8)
      },
      acceptResult: () => set({ stage: 'G6', runState: 'successful', pendingDecision: null }, 'Sonuç kabul edildi.'),
      requestChange: () => set({ stage: 'G2', runState: 'needs-user', pendingDecision: 'approvePlan' }, 'Değişiklik planı bekleniyor.'),
      rollback: () => set({ stage: 'G5', runState: 'stopped', pendingDecision: 'acceptResult' }, 'Önceki güvenli sonuca dönüldü.'),
    }
    const transition = transitions[type as FakeCommand]
    if (!transition) throw new Error('unknown command')
    transition()
  }
  const exact = (host: string | undefined, requestOrigin: string | undefined): boolean => host === new URL(origin).host && requestOrigin === origin
  // Browser top-level GET navigations and fetches commonly omit Origin. The
  // canonical snapshot is read-only, so it accepts that interoperable shape
  // only after the exact Host and SameSite session checks below. Every mutating
  // HTTP path and the WebSocket upgrade remains strict Origin-required.
  const snapshotReadOrigin = (host: string | undefined, requestOrigin: string | undefined): boolean =>
    host === new URL(origin).host && (requestOrigin === undefined || requestOrigin === origin)
  const authenticated = (cookie: string | undefined): boolean => cookie?.split(';').some((item) => item.trim() === COOKIE) === true
  const reply = (response: import('node:http').ServerResponse, status: number, value?: unknown): void => {
    response.statusCode = status
    if (value !== undefined) response.setHeader('content-type', 'application/json; charset=utf-8')
    response.end(value === undefined ? undefined : JSON.stringify(value))
  }
  const server = createServer(async (request, response) => {
    if (closing) {
      response.statusCode = 503
      response.setHeader('connection', 'close')
      response.end()
      return
    }
    const path = new URL(request.url ?? '/', origin).pathname
    requests.push({ method: request.method ?? 'GET', path, host: request.headers.host, origin: request.headers.origin })
    try {
      if (path === '/api/v1/health') return reply(response, 200, { ok: true })
      if (path === '/api/v1/session' && request.method === 'POST') {
        if (!exact(request.headers.host, request.headers.origin)) return reply(response, 403)
        const body = await readBody(request) as { launchToken?: unknown }
        if (tokenUsed || body.launchToken !== TOKEN) return reply(response, 401)
        tokenUsed = true
        response.setHeader('set-cookie', `${COOKIE}; HttpOnly; SameSite=Strict; Path=/`)
        return reply(response, 204)
      }
      if (path.startsWith('/api/')) {
        if (path === '/api/v1/projects/current' && request.method === 'GET') {
          if (!snapshotReadOrigin(request.headers.host, request.headers.origin)) return reply(response, 403)
          if (!authenticated(request.headers.cookie)) return reply(response, 401)
          return reply(response, 200, snapshot)
        }
        if (!exact(request.headers.host, request.headers.origin)) return reply(response, 403)
        if (!authenticated(request.headers.cookie)) return reply(response, 401)
        if (path === '/api/v1/projects' && request.method === 'POST') { if (projectCreated) return reply(response, 409); projectCreated = true; return reply(response, 201) }
        if (path === '/api/v1/projects/current/commands' && request.method === 'POST') { command(await readBody(request)); return reply(response, 204) }
        return reply(response, 404)
      }
      const file = isSafeAssetPath(assets, path)
      if (!file) return reply(response, 404)
      try { await access(file) } catch { return reply(response, 404) }
      response.statusCode = 200
      response.setHeader('content-type', MIME[extname(file)] ?? 'application/octet-stream')
      createReadStream(file).pipe(response)
    } catch {
      reply(response, 400)
    }
  })
  server.on('upgrade', (request, socket) => {
    if (closing) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n')
      return
    }
    const path = new URL(request.url ?? '/', origin).pathname
    requests.push({ method: 'WS', path, host: request.headers.host, origin: request.headers.origin })
    if (path !== '/api/v1/events' || !exact(request.headers.host, request.headers.origin) || !authenticated(request.headers.cookie)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      return
    }
    const key = request.headers['sec-websocket-key']
    if (typeof key !== 'string') { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return }
    const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
    socket.on('data', () => undefined)
    const send = (event: unknown): void => {
      const payload = Buffer.from(JSON.stringify(event), 'utf8')
      if (!socket.destroyed && payload.length < 126) socket.write(Buffer.concat([Buffer.from([0x81, payload.length]), payload]))
    }
    listeners.add(send); sockets.add(socket)
    const close = (): void => { listeners.delete(send); sockets.delete(socket) }
    socket.once('close', close); socket.once('error', close)
  })
  await new Promise<void>((resolvePromise, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolvePromise) })
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    origin,
    launchToken: TOKEN,
    snapshot: () => structuredClone(snapshot),
    setRunState: (runState) => set({
      runState,
      pendingDecision: runState === 'needs-user' ? snapshot.pendingDecision ?? 'submitIdea' : snapshot.pendingDecision,
      // Recovery can follow a completed machine check. The public fixture
      // exposes only verification state, never evidence paths or digests.
      gates: runState === 'recovery-required' && snapshot.gates.length === 0
        ? completedMachineGates()
        : snapshot.gates,
    }, 'Durum güncellendi.'),
    emitWebSocketEvent: (event) => { for (const listener of listeners) listener(event) },
    requests: () => [...requests],
    close: () => {
      if (closePromise) return closePromise
      closing = true
      listeners.clear()
      for (const socket of sockets) socket.destroy()
      sockets.clear()
      closePromise = new Promise((resolvePromise, reject) => {
        const timer = setTimeout(() => {
          server.closeAllConnections()
          reject(new Error('fake cockpit server close timed out'))
        }, 1_000)
        server.close((error) => {
          clearTimeout(timer)
          if (error) reject(error)
          else resolvePromise()
        })
        server.closeAllConnections()
      })
      return closePromise
    },
  }
}
