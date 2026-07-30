#!/usr/bin/env node
// MAP: minimal MCP stdio server used only by the S0 conformance probe.
// EXPOSES: tool `guidelane_probe_echo` (returns MCP_ECHO:<marker>), resource `guidelane://probe/marker`.
// INVARIANTS: stdout carries ONLY newline-delimited JSON-RPC; all diagnostics go to stderr.
//             Zero dependencies — must run on a bare Node 22 with no install step.
// WHY: proves that (a) an MCP server loads into a headless `claude -p` session,
//      (b) the model can actually call its tool, (c) resources are reachable,
//      (d) --strict-mcp-config isolates us from the user's own MCP config.

import { createInterface } from 'node:readline'

const PROTOCOL_FALLBACK = '2025-06-18'
const SERVER_INFO = { name: 'guidelane-probe-echo', version: '0.1.0' }

const TOOLS = [
  {
    name: 'guidelane_probe_echo',
    description:
      'Echo a marker string back. Used by the Guidelane conformance probe to prove MCP tool calls work in headless mode.',
    inputSchema: {
      type: 'object',
      properties: { marker: { type: 'string', description: 'Marker to echo back' } },
      required: ['marker'],
    },
  },
]

const RESOURCES = [
  {
    uri: 'guidelane://probe/marker',
    name: 'Guidelane probe marker',
    description: 'Static resource proving MCP resource reads work in headless mode.',
    mimeType: 'text/plain',
  },
]

const RESOURCE_BODY = 'MCP_RESOURCE_OK'

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n')
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

function handle(msg) {
  const { id, method, params } = msg

  // Notifications carry no id and expect no response.
  if (id === undefined || id === null) return

  switch (method) {
    case 'initialize': {
      // Reflect the client's protocol version only if it is one we actually
      // know. Echoing an arbitrary client-supplied string back as our own
      // declared version is how a server ends up "supporting" a revision it has
      // never implemented — harmless in a fixture, not harmless in Atlas, and
      // this file is the shape Atlas's transport will be modelled on.
      const requested = params && params.protocolVersion
      const KNOWN = new Set(['2024-11-05', '2025-03-26', '2025-06-18'])
      reply(id, {
        protocolVersion: typeof requested === 'string' && KNOWN.has(requested) ? requested : PROTOCOL_FALLBACK,
        capabilities: { tools: {}, resources: {} },
        serverInfo: SERVER_INFO,
      })
      return
    }

    case 'ping':
      reply(id, {})
      return

    case 'tools/list':
      reply(id, { tools: TOOLS })
      return

    case 'tools/call': {
      const name = params && params.name
      if (name !== 'guidelane_probe_echo') {
        replyError(id, -32602, `Unknown tool: ${name}`)
        return
      }
      const marker = (params && params.arguments && params.arguments.marker) || 'NO_MARKER'
      reply(id, { content: [{ type: 'text', text: `MCP_ECHO:${marker}` }], isError: false })
      return
    }

    case 'resources/list':
      reply(id, { resources: RESOURCES })
      return

    case 'resources/read': {
      const uri = params && params.uri
      if (uri !== RESOURCES[0].uri) {
        replyError(id, -32602, `Unknown resource: ${uri}`)
        return
      }
      reply(id, { contents: [{ uri, mimeType: 'text/plain', text: RESOURCE_BODY }] })
      return
    }

    case 'prompts/list':
      reply(id, { prompts: [] })
      return

    default:
      replyError(id, -32601, `Method not found: ${method}`)
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })

// A single unterminated line buffers without bound in readline. One megabyte is
// far above any real MCP frame and far below anything that threatens the process.
const MAX_LINE_BYTES = 1_000_000

rl.on('line', (line) => {
  if (line.length > MAX_LINE_BYTES) {
    process.stderr.write(`[fixture] dropped oversized line (${line.length} bytes)\n`)
    return
  }
  const trimmed = line.trim()
  if (!trimmed) return
  let msg
  try {
    msg = JSON.parse(trimmed)
  } catch {
    process.stderr.write(`guidelane-probe-echo: unparseable line: ${trimmed.slice(0, 200)}\n`)
    return
  }
  try {
    handle(msg)
  } catch (err) {
    process.stderr.write(`guidelane-probe-echo: handler error: ${err && err.message}\n`)
    if (msg && msg.id !== undefined && msg.id !== null) {
      replyError(msg.id, -32603, String((err && err.message) || err))
    }
  }
})

rl.on('close', () => process.exit(0))
