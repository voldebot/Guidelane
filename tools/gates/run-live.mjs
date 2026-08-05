import { access } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { artifactsArgument, main, ROOT } from './lib.mjs'

const mode = process.argv[2]
const liveEnvironmentKeys = ['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LC_CTYPE', 'SHELL']

function assertLivePreconditions() {
  if (process.env.GUIDELANE_LIVE !== '1') throw new Error('GUIDELANE_LIVE=1 is required for live gates')
  if (!artifactsArgument()) throw new Error('--artifacts DIR is required for live gates')
}

export function liveTestEnvironment(parent = process.env) {
  const environment = { GUIDELANE_LIVE: '1', CI: '1', DISABLE_AUTOUPDATER: '1' }
  for (const key of liveEnvironmentKeys) if (parent[key] !== undefined) environment[key] = parent[key]
  return environment
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    // The owner-operated Claude login remains in the OS keychain; no credential is
    // passed, captured, or persisted by this runner.
    const child = spawn(command, args, { cwd: ROOT, stdio: 'ignore', env: liveTestEnvironment() })
    child.once('error', reject)
    child.once('exit', (code, signal) => code === 0 && signal === null ? resolvePromise() : reject(new Error(`live test failed or unavailable (exit=${code ?? 'null'}, signal=${signal ?? 'none'})`)))
  })
}

await main(`live-${mode ?? 'unknown'}`, async () => {
  if (mode === 'self-check-env') {
    await run(process.execPath, ['-e', 'if(process.env.FAKE_UNRELATED_SECRET||process.env.GH_TOKEN||process.env.NPM_TOKEN||process.env.CI!=="1"||process.env.GUIDELANE_LIVE!=="1"||process.env.DISABLE_AUTOUPDATER!=="1")process.exit(9)'])
    return { mode, environment: 'allow-list verified' }
  }
  assertLivePreconditions()
  if (mode === 'journey') throw new Error('not implemented / pilot blocked: supervised production G0-G6 runner is absent')
  if (mode !== 'auth') throw new Error('usage: run-live.mjs auth|journey --artifacts DIR')
  const testFile = 'packages/orchestrator/test/live-auth.test.ts'
  try { await access(new URL(`../../${testFile}`, import.meta.url)) } catch { throw new Error(`not implemented / pilot blocked: required opt-in live test is absent (${testFile})`) }
  await run(process.execPath, ['--test', '--experimental-strip-types', testFile])
  return { mode: 'auth', testFile, credentialSource: 'owner-operated OS login only' }
})
