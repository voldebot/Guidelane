import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  cockpitMessages,
  consumeLaunchFragment,
  semanticActivity,
  snapshotRecovery,
} from '../src/protocol.ts'

const requiredKeys = ['appTitle', 'languageSwitch', 'submitIdea', 'approveBlueprint', 'approvePlan', 'startBuild', 'acceptResult', 'activity', 'waiting', 'running', 'retrying', 'stopped', 'needsUser', 'rateLimit', 'rateLimitFiveHour', 'rateLimitSevenDay', 'recoveryRequired'] as const

function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(stringsIn)
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringsIn)
  return []
}

test('CPT-UNIT-I18N-01 Turkish and English catalogs are complete UTF-8 novice copy', () => {
  for (const language of ['tr', 'en'] as const) {
    for (const key of requiredKeys) assert.equal(typeof cockpitMessages[language][key], 'string', `${language}.${key} is required`)
  }
  assert.match(cockpitMessages.tr.appTitle, /Güvenli|İlerleme|İş/i)
  assert.match(cockpitMessages.tr.submitIdea, /fikr/i)
  assert.notEqual(cockpitMessages.tr.submitIdea, cockpitMessages.en.submitIdea)
  for (const catalog of Object.values(cockpitMessages)) {
    for (const value of stringsIn(catalog)) assert.doesNotMatch(value, /stderr|terminal|diff|reasoning|ghp_|\/Users\//i)
  }
})

test('CPT-UNIT-FINAL-22-RATE-LIMIT-05 catalogs distinguish the public five-hour and seven-day waits without short-copy fallback', () => {
  const expected = {
    tr: {
      fiveHour: 'Beş saatlik kullanım sınırının yenilenmesi bekleniyor.',
      sevenDay: 'Yedi günlük kullanım sınırının yenilenmesi bekleniyor.',
    },
    en: {
      fiveHour: 'Waiting for the five-hour usage limit to reset.',
      sevenDay: 'Waiting for the seven-day usage limit to reset.',
    },
  } as const
  for (const language of ['tr', 'en'] as const) {
    assert.equal(cockpitMessages[language].rateLimitFiveHour, expected[language].fiveHour)
    assert.equal(cockpitMessages[language].rateLimitSevenDay, expected[language].sevenDay)
    assert.notEqual(cockpitMessages[language].rateLimitFiveHour, cockpitMessages[language].rateLimitSevenDay)
    assert.doesNotMatch(cockpitMessages[language].rateLimitFiveHour, /kısa|short/i)
    assert.doesNotMatch(cockpitMessages[language].rateLimitSevenDay, /kısa|short/i)
  }
})

test('CPT-UNIT-REDACTION-02 semantic activity refuses technical/raw payloads and only retains the public shape', () => {
  const safe = semanticActivity({ type: 'phase_update', revision: 7, message: 'Plan hazır; onayınızı bekliyor.' })
  assert.deepEqual(safe, { type: 'phase_update', revision: 7, message: 'Plan hazır; onayınızı bekliyor.' })
  const path = ['/', 'Users', 'owner', 'private.ts'].join('/')
  for (const message of [path, ['gh', 'p_', 'secret'].join(''), ['rea', 'soning:'].join(''), ['std', 'err:'].join(''), ['diff', ' --git'].join('')]) {
    assert.throws(() => semanticActivity({ type: 'phase_update', revision: 8, message }), /unsafe|semantic|redact/i)
  }
})

test('CPT-UNIT-RECONNECT-03 revision gaps always request the canonical snapshot and never replay browser state', () => {
  assert.deepEqual(snapshotRecovery({ lastRevision: 4, eventRevision: 5 }), { kind: 'event' })
  assert.deepEqual(snapshotRecovery({ lastRevision: 4, eventRevision: 7 }), { kind: 'snapshot' })
  assert.deepEqual(snapshotRecovery({ lastRevision: undefined, eventRevision: 0 }), { kind: 'snapshot' })
})

test('CPT-UNIT-LAUNCH-04 consumes the fragment-only launch token and returns a fragment-free URL', () => {
  const launch = consumeLaunchFragment('http://127.0.0.1:43123/#launchToken=0123456789abcdef0123456789abcdef')
  assert.deepEqual(launch, {
    token: '0123456789abcdef0123456789abcdef',
    cleanUrl: 'http://127.0.0.1:43123/',
  })
  assert.throws(() => consumeLaunchFragment('http://127.0.0.1:43123/?launchToken=0123456789abcdef0123456789abcdef'), /fragment|launch/i)
})
