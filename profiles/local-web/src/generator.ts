import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { initializeRepository } from './git.ts'
import { validateSafeGenerationTarget } from './target-path.ts'
import type { GeneratedProject } from './types.ts'

export const PROFILE_VERSIONS = {
  next: '15.5.22',
  react: '19.1.1',
  tailwind: '4.1.13',
  drizzle: '0.45.2',
  sqlite: '12.0.0',
  playwright: '1.62.1',
  axe: '4.10.2',
  postcss: '8.5.18',
  sharp: '0.35.1',
} as const

export const GENERATED_PACKAGE_NAME = 'guidelane-local-web-project'

const generatedPackage = {
  name: GENERATED_PACKAGE_NAME,
  version: '0.1.0',
  private: true,
  type: 'module',
  engines: { node: '>=22.6' },
  scripts: {
    dev: 'next dev',
    lint: 'eslint .',
    typecheck: 'tsc --noEmit',
    unit: 'node --test tests/*.test.mjs',
    'test:unit': 'npm run unit',
    build: 'next build',
    start: 'next start --hostname 127.0.0.1',
    health: 'node scripts/health.mjs',
    axe: 'node scripts/axe.mjs',
    'test:axe': 'npm run axe',
    smoke: 'node scripts/smoke.mjs',
    'test:smoke': 'npm run smoke',
  },
  dependencies: {
    'better-sqlite3': PROFILE_VERSIONS.sqlite,
    'drizzle-orm': PROFILE_VERSIONS.drizzle,
    next: PROFILE_VERSIONS.next,
    react: PROFILE_VERSIONS.react,
    'react-dom': PROFILE_VERSIONS.react,
  },
  devDependencies: {
    '@axe-core/playwright': PROFILE_VERSIONS.axe,
    '@eslint/eslintrc': '3.3.1',
    '@tailwindcss/postcss': PROFILE_VERSIONS.tailwind,
    '@types/better-sqlite3': '9.6.0',
    '@types/node': '22.20.1',
    '@types/react': '19.1.12',
    '@types/react-dom': '19.1.9',
    eslint: '9.37.0',
    'eslint-config-next': PROFILE_VERSIONS.next,
    playwright: PROFILE_VERSIONS.playwright,
    tailwindcss: PROFILE_VERSIONS.tailwind,
    typescript: '5.9.3',
  },
  overrides: {
    postcss: PROFILE_VERSIONS.postcss,
    sharp: PROFILE_VERSIONS.sharp,
  },
} as const

const generatedFiles: Record<string, string> = {
  'app/layout.tsx': `import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = { title: 'Local Web', description: 'A private local project' }

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>
}
`,
  'app/page.tsx': `import AxeTarget from './axe-target'
import BuildTarget from './build-target'
import LintTarget from './lint-target'
import SmokeTarget from './smoke-target'
import TypeTarget from './type-target'

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-8">
      <h1 className="text-3xl font-semibold">Local Web</h1>
      <p className="text-slate-700">A single-user project that stays on this computer.</p>
      <button type="button" aria-label="Create a note" className="w-fit rounded bg-slate-900 px-4 py-2 text-white">Create a note</button>
      <AxeTarget />
      <BuildTarget />
      <LintTarget />
      <SmokeTarget />
      <TypeTarget />
    </main>
  )
}
`,
  'app/axe-target.tsx': `export default function AxeTarget() {
  return (
    <section aria-labelledby="notes-heading">
      <h2 id="notes-heading">Accessible notes</h2>
      <p>Notes stay on this computer.</p>
    </section>
  )
}
`,
  'app/build-target.tsx': `export default function BuildTarget() {
  return <span aria-hidden="true" data-testid="build-target" />
}
`,
  'app/lint-target.tsx': `export default function LintTarget() {
  return <span aria-hidden="true" data-testid="lint-target" />
}
`,
  'app/smoke-target.tsx': `export default function SmokeTarget() {
  return <span data-testid="smoke-target">Ready</span>
}
`,
  'app/type-target.tsx': `export default function TypeTarget() {
  const value = 'ready'
  return <span aria-hidden="true" data-testid="type-target">{value}</span>
}
`,
  'app/globals.css': `@import "tailwindcss";

:root { color-scheme: light; }
body { margin: 0; background: #f8fafc; color: #0f172a; font-family: Arial, sans-serif; }
`,
  'drizzle/schema.ts': `import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const notes = sqliteTable('notes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  body: text('body').notNull(),
})
`,
  'lib/db.ts': `import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

const sqlite = new Database(process.env.LOCAL_WEB_DATABASE ?? './data/local-web.db')
export const db = drizzle(sqlite)
`,
  'next.config.ts': `import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
}

export default nextConfig
`,
  'postcss.config.mjs': `export default { plugins: { '@tailwindcss/postcss': {} } }
`,
  'eslint.config.mjs': `import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FlatCompat } from '@eslint/eslintrc'

const directory = dirname(fileURLToPath(import.meta.url))
const compat = new FlatCompat({ baseDirectory: directory })
export default [...compat.extends('next/core-web-vitals', 'next/typescript')]
`,
  'tsconfig.json': `{"compilerOptions":{"target":"ES2022","lib":["dom","dom.iterable","esnext"],"allowJs":false,"skipLibCheck":true,"strict":true,"noEmit":true,"esModuleInterop":true,"module":"esnext","moduleResolution":"bundler","resolveJsonModule":true,"isolatedModules":true,"jsx":"preserve","incremental":true,"plugins":[{"name":"next"}],"paths":{"@/*":["./*"]}},"include":["next-env.d.ts","**/*.ts","**/*.tsx",".next/types/**/*.ts"],"exclude":["node_modules"]}
`,
  'next-env.d.ts': `/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
`,
  'tests/unit.test.mjs': `import assert from 'node:assert/strict'
import { test } from 'node:test'

test('the local project contract is private and local', () => {
  assert.equal(process.env.GUIDELANE_EXTERNAL_API, undefined)
  assert.equal(process.env.GUIDELANE_TELEMETRY, undefined)
})
`,
  'app/api/health/route.ts': `export const dynamic = 'force-dynamic'

// The harness supplies a cryptographically random node:crypto value for each child start.
const BOOT_INSTANCE_NONCE_PATTERN = /^[a-f0-9]{64}$/

export function GET() {
  const bootInstanceNonce = process.env.BOOT_INSTANCE_NONCE
  if (!bootInstanceNonce || !BOOT_INSTANCE_NONCE_PATTERN.test(bootInstanceNonce)) {
    return Response.json({ ok: false, service: 'local-web' }, { status: 503 })
  }
  return Response.json({ ok: true, service: 'local-web', bootInstanceNonce })
}
`,
  'scripts/health.mjs': `const rawBaseUrl = process.env.LOCAL_WEB_BASE_URL
if (!rawBaseUrl) throw new Error('LOCAL_WEB_BASE_URL is required')
const bootInstanceNonce = process.env.BOOT_INSTANCE_NONCE
if (!bootInstanceNonce) throw new Error('BOOT_INSTANCE_NONCE is required')
if (!/^[a-f0-9]{64}$/.test(bootInstanceNonce)) throw new Error('BOOT_INSTANCE_NONCE is malformed')
const baseUrl = new URL(rawBaseUrl)
if (baseUrl.protocol !== 'http:' || baseUrl.hostname !== '127.0.0.1') throw new Error('health must use the loopback URL')
const response = await fetch(new URL('/api/health', baseUrl))
if (!response.ok) throw new Error('health endpoint returned ' + response.status)
const body = await response.json()
if (body.ok !== true || body.service !== 'local-web' || body.bootInstanceNonce !== bootInstanceNonce) throw new Error('health response contract failed')
console.log('health gate passed')
`,
  'scripts/axe.mjs': `import AxeBuilder from '@axe-core/playwright'
import { chromium } from 'playwright'

const rawBaseUrl = process.env.LOCAL_WEB_BASE_URL
if (!rawBaseUrl) throw new Error('LOCAL_WEB_BASE_URL is required')
const bootInstanceNonce = process.env.BOOT_INSTANCE_NONCE
if (!bootInstanceNonce) throw new Error('BOOT_INSTANCE_NONCE is required')
if (!/^[a-f0-9]{64}$/.test(bootInstanceNonce)) throw new Error('BOOT_INSTANCE_NONCE is malformed')
const baseUrl = new URL(rawBaseUrl)
if (baseUrl.protocol !== 'http:' || baseUrl.hostname !== '127.0.0.1') throw new Error('axe must use the loopback URL')
const healthResponse = await fetch(new URL('/api/health', baseUrl))
if (!healthResponse.ok) throw new Error('health endpoint returned ' + healthResponse.status)
const healthBody = await healthResponse.json()
if (healthBody.ok !== true || healthBody.service !== 'local-web' || healthBody.bootInstanceNonce !== bootInstanceNonce) throw new Error('health response contract failed')
const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    const response = await page.goto(new URL('/', baseUrl).href, { waitUntil: 'networkidle' })
    if (!response || !response.ok()) throw new Error('axe page returned an unavailable response')
    const result = await new AxeBuilder({ page }).analyze()
    if (result.violations.length > 0) throw new Error('axe reported ' + result.violations.length + ' violations')
    console.log('axe gate passed')
  } finally {
    await context.close()
  }
} finally {
  await browser.close()
}
`,
  'scripts/smoke.mjs': `import { chromium } from 'playwright'

const rawBaseUrl = process.env.LOCAL_WEB_BASE_URL
if (!rawBaseUrl) throw new Error('LOCAL_WEB_BASE_URL is required')
const bootInstanceNonce = process.env.BOOT_INSTANCE_NONCE
if (!bootInstanceNonce) throw new Error('BOOT_INSTANCE_NONCE is required')
if (!/^[a-f0-9]{64}$/.test(bootInstanceNonce)) throw new Error('BOOT_INSTANCE_NONCE is malformed')
const baseUrl = new URL(rawBaseUrl)
if (baseUrl.protocol !== 'http:' || baseUrl.hostname !== '127.0.0.1') throw new Error('smoke must use the loopback URL')
const healthResponse = await fetch(new URL('/api/health', baseUrl))
if (!healthResponse.ok) throw new Error('health endpoint returned ' + healthResponse.status)
const healthBody = await healthResponse.json()
if (healthBody.ok !== true || healthBody.service !== 'local-web' || healthBody.bootInstanceNonce !== bootInstanceNonce) throw new Error('health response contract failed')
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const response = await page.goto(new URL('/', baseUrl).href, { waitUntil: 'networkidle' })
  if (!response || !response.ok()) throw new Error('smoke page returned an unavailable response')
  await page.getByRole('heading', { name: 'Local Web' }).waitFor()
  await page.getByRole('button', { name: 'Create a note' }).waitFor()
  await page.getByTestId('smoke-target').waitFor()
  if (new URL(page.url()).pathname !== '/') throw new Error('smoke route contract failed')
  console.log('smoke gate passed')
} finally {
  await browser.close()
}
`,
  '.gitignore': `node_modules
.next
out
.guidelane/artifacts
.env*
!.env.example
`,
  '.env.example': `LOCAL_WEB_DATABASE=./data/local-web.db
`,
  'README.md': `# Guidelane Local Web

This is an ejectable, single-user Next.js project. It has no Guidelane runtime dependency, authentication, telemetry, deployment, payment, or external API integration.

The profile contract pins Next.js, React 19, Tailwind v4, Drizzle ORM, SQLite, Playwright, and axe-core in package.json and package-lock.json.
`,
}

async function writeProjectFile(directory: string, relativePath: string, contents: string): Promise<void> {
  const target = join(directory, relativePath)
  const parent = target.slice(0, target.lastIndexOf('/'))
  await mkdir(parent, { recursive: true })
  await writeFile(target, contents, 'utf8')
}

async function readLockTemplate(): Promise<string> {
  return readFile(new URL('../package-lock.json', import.meta.url), 'utf8')
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

async function validateTargetDirectory(directory: string): Promise<void> {
  let target
  try {
    target = await lstat(directory)
  } catch (error: unknown) {
    if (hasErrorCode(error, 'ENOENT')) return
    throw error
  }

  if (!target.isDirectory()) throw new Error(`generation target must be a directory: ${directory}`)

  const entries = await readdir(directory)
  if (entries.length > 0) throw new Error(`generation target must be empty: ${directory}`)
}

export async function generateProject(directory: string): Promise<GeneratedProject> {
  const safeDirectory = await validateSafeGenerationTarget(directory)
  await validateTargetDirectory(safeDirectory)
  await validateSafeGenerationTarget(safeDirectory)
  await mkdir(safeDirectory, { recursive: true })
  await validateSafeGenerationTarget(safeDirectory)
  await validateTargetDirectory(safeDirectory)
  await writeProjectFile(safeDirectory, 'package.json', JSON.stringify(generatedPackage, null, 2) + '\n')
  await writeProjectFile(safeDirectory, 'package-lock.json', await readLockTemplate())
  for (const [relativePath, contents] of Object.entries(generatedFiles)) await writeProjectFile(safeDirectory, relativePath, contents)
  const initialSnapshot = initializeRepository(safeDirectory)
  return { directory, packageName: GENERATED_PACKAGE_NAME, initialSnapshot }
}

export function generatedManifest(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(generatedPackage)) as Record<string, unknown>
}

export const generateManifest = generatedManifest
