import assert from 'node:assert/strict'
import { connect, type Socket } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createFakeCockpitServer } from './fake-orchestrator.ts'

function activeWebSocket(origin: string, cookie: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const target = new URL(origin)
    const socket = connect({ host: target.hostname, port: Number(target.port) })
    socket.once('error', reject)
    socket.once('data', (data: Buffer) => {
      if (data.toString('ascii').startsWith('HTTP/1.1 101')) resolve(socket)
      else reject(new Error(`unexpected WebSocket response: ${data.toString('ascii')}`))
    })
    socket.once('connect', () => socket.write([
      'GET /api/v1/events HTTP/1.1',
      `Host: ${target.host}`,
      `Origin: ${origin}`,
      `Cookie: ${cookie}`,
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Sec-WebSocket-Version: 13',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      '',
      '',
    ].join('\r\n')))
  })
}

test('CPT-FIXTURE-HTTP-01 snapshot GET accepts omitted Origin only with exact Host and session; mutations remain Origin-strict', async () => {
  const assets = await mkdtemp(join(tmpdir(), 'guidelane-cockpit-fixture-'))
  const server = await createFakeCockpitServer(assets)
  try {
    const session = await fetch(`${server.origin}/api/v1/session`, {
      method: 'POST',
      headers: { Origin: server.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ launchToken: server.launchToken }),
    })
    assert.equal(session.status, 204)
    const cookie = session.headers.get('set-cookie') ?? ''

    assert.equal((await fetch(`${server.origin}/api/v1/projects/current`, { headers: { Cookie: cookie } })).status, 200)
    assert.equal((await fetch(`${server.origin}/api/v1/projects/current`, { headers: { Cookie: cookie, Origin: 'http://evil.example' } })).status, 403)
    assert.equal((await fetch(`${server.origin}/api/v1/projects/current/commands`, {
      method: 'POST', headers: { Cookie: cookie, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'submitIdea' }),
    })).status, 403)
    assert.equal((await fetch(`${server.origin}/api/v1/projects`, {
      method: 'POST', headers: { Cookie: cookie, 'content-type': 'application/json' }, body: JSON.stringify({ projectId: 'cockpit-novice' }),
    })).status, 403)
  } finally {
    await server.close()
    await rm(assets, { recursive: true, force: true })
  }
})

test('CPT-FIXTURE-CLOSE-02 close remains bounded when an active WebSocket immediately reconnects', async () => {
  const assets = await mkdtemp(join(tmpdir(), 'guidelane-cockpit-fixture-'))
  const server = await createFakeCockpitServer(assets)
  let socket: Socket | undefined
  try {
    const session = await fetch(`${server.origin}/api/v1/session`, {
      method: 'POST',
      headers: { Origin: server.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ launchToken: server.launchToken }),
    })
    socket = await activeWebSocket(server.origin, session.headers.get('set-cookie') ?? '')
    const reconnectSettled = new Promise<void>((resolvePromise) => {
      socket!.once('close', () => {
        const target = new URL(server.origin)
        const retry = connect({ host: target.hostname, port: Number(target.port) })
        retry.once('error', resolvePromise)
        retry.once('connect', () => { retry.end(); resolvePromise() })
      })
    })
    const closed = await Promise.race([
      server.close().then(() => true),
      new Promise<boolean>((resolvePromise) => setTimeout(() => resolvePromise(false), 1_500)),
    ])
    assert.equal(closed, true, 'fixture close must not wait for client reconnect timers')
    await Promise.race([
      reconnectSettled,
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error('reconnect attempt did not settle')), 1_000)),
    ])
  } finally {
    socket?.destroy()
    await server.close()
    await rm(assets, { recursive: true, force: true })
  }
})
