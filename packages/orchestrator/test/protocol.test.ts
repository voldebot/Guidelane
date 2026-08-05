import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import {
  ArtifactStore,
  Orchestrator,
  buildEngineEnv,
  createLoopbackServer,
  redactEvent,
  validateCommand,
} from '../src/index.ts'
import { digest, phaseRun, projectId, snapshot, testGitHead, withTempDir } from './helpers.ts'

const http08Title = 'HTTP-08 loopback JSON command preserves exact UTF-8 Turkish input bytes'

test('preserves Turkish text by its exact UTF-8 bytes and digest', async () => {
  await withTempDir(async (root) => {
    const store = await ArtifactStore.open({ root, projectId, gitHead: testGitHead })
    const text = 'Şifre değil: İğne, çığ, öykü — “güvenli”'
    const bytes = Buffer.from(text, 'utf8')
    await store.publish({
      snapshot: snapshot({ revision: 1 }),
      run: phaseRun({ evidence: [{ path: 'evidence/turkish.txt', sha256: digest(bytes) }] }),
      artifacts: { 'evidence/turkish.txt': bytes },
    })

    const restored = await store.artifactBytes('evidence/turkish.txt')
    assert.deepEqual(restored, bytes)
    assert.equal(digest(restored), digest(bytes))
  })
})

test(http08Title, async () => {
  const captured: unknown[] = []
  const initialSnapshot = {
    schemaVersion: 1,
    projectId,
    revision: 0,
    stage: 'G0',
    runState: 'idle',
    language: 'tr',
    blueprintRevision: 0,
    gates: [],
    pendingDecision: 'submitIdea',
  }
  const capture = {
    snapshot: async () => structuredClone(initialSnapshot),
    command: async (value: unknown) => { captured.push(structuredClone(value)); return structuredClone(initialSnapshot) },
    subscribe: () => () => undefined,
  }
  const token = '77777777777777777777777777777777'
  const server = await createLoopbackServer({ orchestrator: capture as unknown as Orchestrator, port: 0, launchToken: token })
  try {
    const session = await fetch(`${server.origin}/api/v1/session`, {
      method: 'POST',
      headers: { Origin: server.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ launchToken: token }),
    })
    const text = 'ı, İ, ğ, ş, ö, ü, ç'
    const response = await fetch(`${server.origin}/api/v1/projects/current/commands`, {
      method: 'POST',
      headers: { Origin: server.origin, Cookie: session.headers.get('set-cookie') ?? '', 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ type: 'submitIdea', idea: text }),
    })
    assert.equal(response.status, 204)
    assert.deepEqual(captured, [{ type: 'submitIdea', idea: text }])
    assert.deepEqual(Buffer.from((captured[0] as { idea: string }).idea, 'utf8'), Buffer.from(text, 'utf8'))
  } finally {
    await server.close()
  }
})

test('the published transition table exposes no implicit stage jump', () => {
  // The table is a public audit surface. A command must be represented here
  // before its implementation can change state; this catches a new handler
  // that bypasses the state machine.
  const expected = {
    submitIdea: ['idea'],
    approveBlueprint: ['blueprint_review'],
    requestBlueprintChange: ['blueprint_review'],
    approvePlan: ['plan_review'],
    startBuild: ['ready_to_build'],
    acceptResult: ['result_review'],
    requestChange: ['result_review'],
    rollback: ['accepted'],
  }
  for (const [command, sources] of Object.entries(expected)) {
    assert.deepEqual(Orchestrator.transitionSources(command), sources, `${command} must declare every legal source stage`)
  }
})

test('rejects a command outside its explicit transition and a successful gate without immutable evidence', async () => {
  await withTempDir(async (root) => {
    const orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
    await assert.rejects(orchestrator.command({ type: 'startBuild' }), /transition|stage|not allowed/i)

    await assert.rejects(
      orchestrator.recordGate({
        name: 'typecheck',
        status: 'passed',
        authority: 'machine',
        evidence: [],
      }),
      /evidence|digest|immutable/i
    )
  })
})

test('rejects unknown, malformed, and technically smuggled command bodies before state changes', async () => {
  const malformed = [
    null,
    {},
    { type: 'deleteProject' },
    { type: 'submitIdea', idea: 42 },
    { type: 'submitIdea', idea: 'iyi fikir', shell: 'rm -rf /' },
  ]
  for (const value of malformed) {
    assert.throws(() => validateCommand(value), /invalid|unknown|schema|command/i)
  }
})

test('redacts raw engine material semantically instead of serializing a disguised copy', async () => {
  const hostile = JSON.parse(await readFile(new URL('../test-fixtures/redaction-hostile-payloads.json', import.meta.url), 'utf8')) as { event: Record<string, unknown> }
  const event = redactEvent({
    type: 'stream_event',
    revision: 7,
    message: 'Plan hazır; devam etmek için onayınızı bekliyorum.',
    ...hostile.event,
  })
  assert.deepEqual(event, {
    type: 'phase_update',
    revision: 7,
    message: 'Plan hazır; devam etmek için onayınızı bekliyorum.',
  })
  assert.equal(JSON.stringify(event).match(/alice|DATABASE_URL|secret|thinking|private\.ts|ghp_/i), null)
})

test('uses a true minimal child environment, retaining only portable operating context', () => {
  const child = buildEngineEnv({
    PATH: '/usr/bin:/bin',
    HOME: '/tmp/guidelane-home',
    LANG: 'tr_TR.UTF-8',
    LC_ALL: 'tr_TR.UTF-8',
    TERM: 'xterm-256color',
    GITHUB_TOKEN: 'github-secret',
    NPM_TOKEN: 'npm-secret',
    DATABASE_URL: 'postgres://secret',
    CI: '1',
    UNRELATED_SECRET: 'not allowed',
  })
  assert.equal(child.PATH, '/usr/bin:/bin')
  assert.equal(child.HOME, '/tmp/guidelane-home')
  assert.equal(child.LANG, 'tr_TR.UTF-8')
  assert.equal(child.LC_ALL, 'tr_TR.UTF-8')
  assert.equal(child.GITHUB_TOKEN, undefined)
  assert.equal(child.NPM_TOKEN, undefined)
  assert.equal(child.DATABASE_URL, undefined)
  assert.equal(child.UNRELATED_SECRET, undefined)
  assert.equal(child.CI, undefined)
})

test('returns a canonical snapshot, not a partial event stream, after a revision gap', async () => {
  await withTempDir(async (root) => {
    const orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
    await orchestrator.command({ type: 'submitIdea', idea: 'Türkçe bir yerel web uygulaması' })
    const update = await orchestrator.eventsSince(-1)
    assert.equal(update.kind, 'snapshot')
    assert.equal(update.snapshot.projectId, projectId)
    assert.ok(update.snapshot.revision > 0)
    assert.equal('events' in update, false)
  })
})
