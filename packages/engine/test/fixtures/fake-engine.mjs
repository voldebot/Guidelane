#!/usr/bin/env node
// A fake engine that speaks the MEASURED stream-json lifecycle, so the adapter's
// own plumbing can be tested without spending quota — and, more importantly, so
// the failure arms can be tested at all. The real engine cannot be asked to omit
// its init receipt, flood stderr, or send a malformed line.
//
// It is deliberately faithful to what was measured, not to what would be
// convenient:
//   - emits `system/init` FIRST, exactly as the real engine does
//   - `result` is PER TURN; the process does not exit after one
//   - stdin closing is the terminator, and it keeps writing briefly afterwards
//     (the real engine delivered 6,243 bytes after the close)
//
// Arms are argv flags so a test reads as a sentence. Everything is off by
// default: a test that forgets to ask for a failure gets a healthy session.
//
//   --no-init          never send the receipt (the gate must fail on ABSENCE)
//   --model <id>       what the receipt reports (default: a haiku build)
//   --silent           accept turns, never answer (a hung phase)
//   --garbage          emit unparseable lines alongside the good ones
//   --thinking         wrap a thinking_delta in a stream_event envelope
//   --stderr-flood     write ~1 MB to stderr before doing anything else
//   --exit-early       exit as soon as the first turn arrives
//   --never-exit       ignore stdin closing (the measured "stdin open" shape,
//                      and the only way to reach the post-finish stall arm)

import { argv, stdin, stdout, stderr, exit } from 'node:process'

const has = (f) => argv.includes(f)
const valueOf = (f, dflt) => {
  const i = argv.indexOf(f)
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : dflt
}
const say = (obj) => stdout.write(`${JSON.stringify(obj)}\n`)

// stderr FIRST and unconditionally large, because the hazard being reproduced is
// a parent that never drains it: the write blocks once the pipe buffer fills and
// nothing after this line ever runs.
if (has('--stderr-flood')) stderr.write('x'.repeat(1024 * 1024))

if (!has('--no-init')) {
  say({
    type: 'system',
    subtype: 'init',
    session_id: '00000000-0000-4000-8000-000000000000',
    model: valueOf('--model', 'claude-haiku-4-5-20251001'),
    permissionMode: 'auto',
    apiKeySource: 'none',
    claude_code_version: '2.1.220',
    mcp_servers: [],
    tools: [],
  })
}

let turns = 0
let buf = ''
stdin.setEncoding('utf8')
stdin.on('data', (chunk) => {
  buf += chunk
  const lines = buf.split('\n')
  buf = lines.pop() ?? ''
  for (const line of lines) {
    if (line.trim() === '') continue
    turns += 1
    if (has('--exit-early')) exit(0)
    if (has('--silent')) continue
    if (has('--garbage')) stdout.write('this is not json\n')
    if (has('--thinking')) {
      say({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'LEAK-CANARY' } },
      })
    }
    say({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: `TURN_${turns}_OK` }] },
    })
    say({ type: 'result', subtype: 'success', num_turns: turns, is_error: false })
  }
})

// Closing stdin is the terminator — and output keeps arriving after it, because
// that is what the real engine does and a closer that stops reading would
// truncate the phase.
stdin.on('end', () => {
  if (has('--never-exit')) {
    // The measured shape of a session that ignores its terminator. Keep the loop
    // alive so the adapter's post-finish stall arm has something to detect.
    setInterval(() => {}, 1_000)
    return
  }
  say({ type: 'system', subtype: 'hook_response', hook_name: 'Stop', outcome: 'success', exit_code: 0, stdout: '' })
  setTimeout(() => exit(0), 20)
})
