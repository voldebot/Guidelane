import assert from 'node:assert/strict'
import test from 'node:test'
import { assertStaticTopLevelTapExecutionSelectorInSource, assertTapExecutionSelectorInSource } from './lib.mjs'

test('legacy TAP execution selectors must be verbatim in their declared test source', () => {
  const selector = 'S2-TAP-01 exact opaque selector'
  assert.throws(
    () => assertTapExecutionSelectorInSource("test('display name only', () => {})", selector),
    /selector is absent/,
  )
  assert.doesNotThrow(() => assertTapExecutionSelectorInSource(`const title = '${selector}'\ntest(title, () => {})`, selector))
})

test('new TAP execution selectors must be exactly one static top-level title', () => {
  const selector = 'S2-TAP-01 exact opaque selector'
  assert.doesNotThrow(() => assertStaticTopLevelTapExecutionSelectorInSource(`test('${selector}', () => {})`, selector))
  assert.doesNotThrow(() => assertStaticTopLevelTapExecutionSelectorInSource(`test(\"${selector}\", () => {})`, selector))
  assert.throws(() => assertStaticTopLevelTapExecutionSelectorInSource(`test(\`${selector}\`, () => {})`, selector), /static top-level/)
  assert.throws(() => assertStaticTopLevelTapExecutionSelectorInSource(`for (const item of ['x']) { test(\`${selector}\`, () => {}) }`, selector), /static top-level/)
  assert.throws(() => assertStaticTopLevelTapExecutionSelectorInSource(`test('${selector}', () => {})\ntest('${selector}', () => {})`, selector), /exactly once/)
})
