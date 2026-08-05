import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const stylesPath = fileURLToPath(new URL('../src/styles.css', import.meta.url))
const requiredSurfaceTokens = [
  '--surface-canvas',
  '--surface-rail',
  '--surface-input',
  '--surface-primary',
  '--surface-primary-hover',
] as const
const surfaceUsage = {
  '--surface-canvas': /:root\s*\{[\s\S]*?background\s*:\s*var\(--surface-canvas\)/,
  '--surface-rail': /\.rail\s*\{[\s\S]*?background\s*:\s*var\(--surface-rail\)/,
  '--surface-input': /textarea\s*\{[\s\S]*?background\s*:\s*var\(--surface-input\)/,
  '--surface-primary': /\.primary\s*\{[\s\S]*?background\s*:\s*var\(--surface-primary\)/,
  '--surface-primary-hover': /\.primary:hover\s*\{[\s\S]*?background\s*:\s*var\(--surface-primary-hover\)/,
} as const

function hexColor(value: string): readonly [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(value.trim())
  assert.ok(match, `design color tokens must use six-digit hexadecimal colors; received ${value}`)
  const hex = match[1]
  return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)]
}

function relativeLuminance(color: readonly [number, number, number]): number {
  const linear = color.map((channel) => {
    const srgb = channel / 255
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [relativeLuminance(hexColor(first)), relativeLuminance(hexColor(second))].sort((left, right) => right - left)
  return (lighter + 0.05) / (darker + 0.05)
}

test('CPT-UNIT-FINAL-27-A11Y-FOCUS-22 exposes a CSS-token focus indicator with at least 3:1 contrast against every adjacent supported surface', async () => {
  const css = await readFile(stylesPath, 'utf8')
  const root = /:root\s*\{([\s\S]*?)\}/.exec(css)?.[1]
  assert.ok(root, 'the CSS design contract must declare root color tokens')
  const tokens = new Map<string, string>()
  for (const token of ['--focus-indicator', ...requiredSurfaceTokens]) {
    const value = new RegExp(`${token}\\s*:\\s*([^;]+);`).exec(root)?.[1]
    assert.ok(value, `missing required CSS design token ${token}`)
    tokens.set(token, value)
  }

  assert.match(css, /:focus-visible\s*\{[\s\S]*?outline\s*:\s*[^;]*var\(--focus-indicator\)/, 'the rendered focus outline must consume the tested focus token')
  for (const surface of requiredSurfaceTokens) {
    assert.match(css, surfaceUsage[surface], `${surface} must be the actual adjacent surface used by the supported control`)
    const ratio = contrastRatio(tokens.get('--focus-indicator')!, tokens.get(surface)!)
    assert.ok(ratio >= 3, `--focus-indicator must have at least 3:1 contrast against ${surface}; observed ${ratio.toFixed(2)}:1`)
  }
})
