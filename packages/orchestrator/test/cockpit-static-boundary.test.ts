import assert from 'node:assert/strict'
import { chmod, chown, mkdir, symlink, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { join } from 'node:path'
import { test } from 'node:test'
import * as orchestratorPublic from '../src/index.ts'
import { projectId, testGitHead, withTempDir } from './helpers.ts'

type StaticServerOptions = Parameters<typeof orchestratorPublic.createLoopbackServer>[0] & { cockpitRoot: string }

function rawGet(origin: string, path: string): Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(origin)
    const req = request({ hostname: target.hostname, port: target.port, path, method: 'GET' }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk: string) => { body += chunk })
      response.once('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body }))
    })
    req.once('error', reject)
    req.end()
  })
}

async function assertStaticUnavailableButApiAlive(root: string, cockpitRoot: string): Promise<void> {
  const orchestrator = await orchestratorPublic.Orchestrator.open({ root, projectId, gitHead: testGitHead })
  let server: Awaited<ReturnType<typeof orchestratorPublic.createLoopbackServer>>
  try {
    server = await orchestratorPublic.createLoopbackServer({
      orchestrator,
      port: 0,
      launchToken: '0123456789abcdef0123456789abcdef',
      cockpitRoot,
    } as StaticServerOptions)
  } catch {
    return
  }
  try {
    assert.equal((await rawGet(server.origin, '/api/v1/health')).status, 200, 'rejecting static assets must not weaken the loopback API trust boundary')
    assert.equal((await rawGet(server.origin, '/')).status, 404, 'an unsafe cockpit root must never be served as a static document')
  } finally {
    await server.close()
  }
}

test('S2-COCKPIT-STATIC-01 same-origin static cockpit files are public but carry restrictive document headers', async () => {
  await withTempDir(async (root) => {
    const cockpitRoot = join(root, 'cockpit-assets')
    await mkdir(join(cockpitRoot, 'assets'), { recursive: true })
    await writeFile(join(cockpitRoot, 'index.html'), '<!doctype html><script src="/assets/app-a1b2c3.js"></script>', 'utf8')
    await writeFile(join(cockpitRoot, 'assets', 'app-a1b2c3.js'), 'console.log("cockpit")', 'utf8')
    await writeFile(join(cockpitRoot, 'assets', 'app-a1b2c3.css'), 'body{color:#123}', 'utf8')
    const orchestrator = await orchestratorPublic.Orchestrator.open({ root, projectId, gitHead: testGitHead })
    const server = await orchestratorPublic.createLoopbackServer({
      orchestrator,
      port: 0,
      launchToken: '0123456789abcdef0123456789abcdef',
      cockpitRoot,
    } as StaticServerOptions)
    try {
      const index = await rawGet(server.origin, '/')
      assert.equal(index.status, 200)
      assert.match(index.body, /app-a1b2c3\.js/)
      const contentSecurityPolicy = index.headers['content-security-policy']
      assert.ok(typeof contentSecurityPolicy === 'string', 'index must send a string CSP header')
      assert.match(contentSecurityPolicy, /default-src 'self'/i)
      assert.equal(index.headers['x-content-type-options'], 'nosniff')
      assert.equal(index.headers['referrer-policy'], 'no-referrer')
      assert.match(index.headers['cache-control'] ?? '', /no-store/i)
      assert.equal(index.headers['access-control-allow-origin'], undefined)

      const script = await rawGet(server.origin, '/assets/app-a1b2c3.js')
      assert.equal(script.status, 200)
      assert.match(script.headers['content-type'] ?? '', /javascript/i)
      assert.match(script.headers['cache-control'] ?? '', /immutable|no-store/i)
      const css = await rawGet(server.origin, '/assets/app-a1b2c3.css')
      assert.equal(css.status, 200)
      assert.match(css.headers['content-type'] ?? '', /text\/css/i)
    } finally {
      await server.close()
    }
  })
})

test('S2-COCKPIT-STATIC-02 static serving rejects unknown, traversal, symlink, dotfile, and API-shadow paths', async () => {
  await withTempDir(async (root) => {
    const cockpitRoot = join(root, 'cockpit-assets')
    const outside = join(root, 'outside')
    await mkdir(join(cockpitRoot, 'assets'), { recursive: true })
    await mkdir(outside)
    await writeFile(join(cockpitRoot, 'index.html'), '<!doctype html>', 'utf8')
    await writeFile(join(cockpitRoot, '.env'), 'not-public', 'utf8')
    await writeFile(join(outside, 'secret.js'), 'not-public', 'utf8')
    await symlink(outside, join(cockpitRoot, 'assets', 'escape'))
    await mkdir(join(cockpitRoot, 'api', 'v1', 'projects'), { recursive: true })
    await writeFile(join(cockpitRoot, 'api', 'v1', 'projects', 'current'), 'static shadow', 'utf8')
    const orchestrator = await orchestratorPublic.Orchestrator.open({ root, projectId, gitHead: testGitHead })
    const server = await orchestratorPublic.createLoopbackServer({
      orchestrator,
      port: 0,
      launchToken: '0123456789abcdef0123456789abcdef',
      cockpitRoot,
    } as StaticServerOptions)
    try {
      for (const path of ['/missing.js', '/.env', '/assets/escape/secret.js', '/../outside/secret.js', '/%2e%2e/outside/secret.js', '/assets/%2e%2e/%2e%2e/outside/secret.js']) {
        assert.equal((await rawGet(server.origin, path)).status, 404, `${path} must fail closed`)
      }
      const apiShadow = await rawGet(server.origin, '/api/v1/projects/current')
      assert.equal(apiShadow.status, 401, 'API routes must remain API routes, never static cockpit files')
      assert.notEqual(apiShadow.body, 'static shadow')
    } finally {
      await server.close()
    }
  })
})

test('FINAL-29-COCKPIT-ROOT-01 never serves a group- or world-writable cockpit root, while loopback API health remains available', async (t) => {
  for (const [label, mode] of [['group-writable', 0o770], ['world-writable', 0o707]] as const) {
    await t.test(label, async () => {
      await withTempDir(async (root) => {
        const cockpitRoot = join(root, label)
        await mkdir(cockpitRoot, { mode: 0o700 })
        await writeFile(join(cockpitRoot, 'index.html'), `<!doctype html>${label}`, 'utf8')
        await chmod(cockpitRoot, mode)
        await assertStaticUnavailableButApiAlive(root, cockpitRoot)
      })
    })
  }
})

test('FINAL-29-COCKPIT-ROOT-02 never serves a private cockpit leaf below an unsafe existing ancestor, while loopback API health remains available', async () => {
  await withTempDir(async (root) => {
    const unsafeAncestor = join(root, 'caller-writable-ancestor')
    const cockpitRoot = join(unsafeAncestor, 'private-cockpit')
    await mkdir(cockpitRoot, { recursive: true, mode: 0o700 })
    await chmod(cockpitRoot, 0o700)
    await writeFile(join(cockpitRoot, 'index.html'), '<!doctype html>private leaf', 'utf8')
    await chmod(unsafeAncestor, 0o777)
    await assertStaticUnavailableButApiAlive(root, cockpitRoot)
  })
})

test('FINAL-29-COCKPIT-ROOT-03 never serves a foreign-owned cockpit root when a fixture can create one', async (t) => {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) {
    t.skip('creating a foreign-owned cockpit root requires a privileged test account')
    return
  }
  await withTempDir(async (root) => {
    const cockpitRoot = join(root, 'foreign-owned-cockpit')
    await mkdir(cockpitRoot, { mode: 0o700 })
    await writeFile(join(cockpitRoot, 'index.html'), '<!doctype html>foreign', 'utf8')
    await chown(cockpitRoot, 1, 0)
    try {
      await assertStaticUnavailableButApiAlive(root, cockpitRoot)
    } finally {
      await chown(cockpitRoot, 0, 0)
    }
  })
})

test('S2-COCKPIT-LAUNCH-03 public launchUrl validates loopback and keeps the token fragment-only', () => {
  const api = orchestratorPublic as typeof orchestratorPublic & {
    launchUrl(origin: string, token: string): string
  }
  const token = '0123456789abcdef0123456789abcdef'
  const url = new URL(api.launchUrl('http://127.0.0.1:43123', token))
  assert.equal(url.origin, 'http://127.0.0.1:43123')
  assert.equal(url.pathname, '/')
  assert.equal(url.search, '')
  assert.equal(url.hash, `#launchToken=${encodeURIComponent(token)}`)
  assert.equal(`${url.pathname}${url.search}`.includes(token), false)
  for (const invalid of ['http://localhost:43123', 'https://127.0.0.1:43123', 'http://127.0.0.1:43123/cockpit']) {
    assert.throws(() => api.launchUrl(invalid, token), /loopback|origin|127\.0\.0\.1/i)
  }
  assert.throws(() => api.launchUrl('http://127.0.0.1:43123', 'not-a-128-bit-token'), /token|128/i)
})
