import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyIsolation, assertIsolated, isSessionInvocation } from '../src/isolation.ts'

test('a session invocation gets both isolation flags', () => {
  const args = applyIsolation(['-p', '--output-format', 'stream-json'])
  assert.ok(args.includes('--strict-mcp-config'))
  const at = args.indexOf('--setting-sources')
  assert.notEqual(at, -1)
  assert.equal(args[at + 1], '')
})

test('a non-session invocation is left alone', () => {
  assert.deepEqual(applyIsolation(['--version']), ['--version'])
  assert.equal(isSessionInvocation(['--version']), false)
})

test('--setting-sources is checked by VALUE, not presence', () => {
  // `--setting-sources user` satisfied the old includes() check, so the session
  // loaded the operator's settings while the result reported it as isolated.
  assert.throws(
    () => applyIsolation(['-p', '--setting-sources', 'user']),
    /must be '' on an isolated session/
  )
})

test('the session classifier throws rather than silently skipping isolation', () => {
  // A session-only flag with no -p means the sniff is wrong. Failing loudly
  // beats measuring a contaminated session.
  assert.throws(
    () => applyIsolation(['--permission-mode', 'auto']),
    /session classifier failed/
  )
})

test('ambient opts out, explicitly', () => {
  const args = applyIsolation(['-p'], { ambient: true })
  assert.deepEqual(args, ['-p'])
})

test('assertIsolated fires on argv that lost the pair', () => {
  assert.throws(() => assertIsolated(['-p']), /missing --strict-mcp-config/)
  assert.throws(() => assertIsolated(['-p', '--strict-mcp-config']), /must carry --setting-sources/)
  assert.throws(
    () => assertIsolated(['-p', '--strict-mcp-config', '--setting-sources', 'user']),
    /must carry --setting-sources/
  )
})

test('assertIsolated accepts what applyIsolation produces', () => {
  assert.doesNotThrow(() => assertIsolated(applyIsolation(['-p', '--verbose'])))
})
