import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { access } from 'node:fs/promises'
import { join } from 'node:path'

const IDENTITY_NAME = 'Guidelane'
const IDENTITY_EMAIL = 'guidelane@local.invalid'
const ACCEPTED_PREFIX = 'Guidelane accepted:'
const TRUSTED_GIT_EXECUTABLE = '/usr/bin/git'
const GIT_RUNTIME_PREFIX = '/tmp/guidelane-local-web-git-'
const SAFE_PATH = '/usr/bin:/bin'

let trustedGitUnavailableForTest = false

interface GitRuntime {
  home: string
  configHome: string
  globalConfig: string
  template: string
  hooks: string
  root: string
}

function trustedGitExecutable(): string {
  if (trustedGitUnavailableForTest) throw new Error('trusted Git executable is unavailable')

  try {
    const metadata = statSync(TRUSTED_GIT_EXECUTABLE)
    if (!metadata.isFile() || (metadata.mode & 0o111) === 0) throw new Error('not an executable file')
  } catch {
    throw new Error('trusted Git executable is unavailable')
  }

  return TRUSTED_GIT_EXECUTABLE
}

function createGitRuntime(): GitRuntime {
  const root = mkdtempSync(GIT_RUNTIME_PREFIX)
  const home = join(root, 'home')
  const configHome = join(root, 'config')
  const template = join(root, 'template')
  const hooks = join(root, 'hooks')
  const globalConfig = join(root, 'global-gitconfig')
  mkdirSync(home, { mode: 0o700 })
  mkdirSync(configHome, { mode: 0o700 })
  mkdirSync(template, { mode: 0o700 })
  mkdirSync(hooks, { mode: 0o700 })
  writeFileSync(globalConfig, '', { mode: 0o600 })
  return { home, configHome, globalConfig, template, hooks, root }
}

function git(directory: string, args: string[]): string {
  const executable = trustedGitExecutable()
  const runtime = createGitRuntime()
  try {
    return execFileSync(executable, [
      '-c', `core.hooksPath=${runtime.hooks}`,
      '-c', `init.templateDir=${runtime.template}`,
      '-C', directory,
      ...args,
    ], {
      encoding: 'utf8',
      env: {
        PATH: SAFE_PATH,
        HOME: runtime.home,
        XDG_CONFIG_HOME: runtime.configHome,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: runtime.globalConfig,
        GIT_TEMPLATE_DIR: runtime.template,
        GIT_TERMINAL_PROMPT: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } finally {
    rmSync(runtime.root, { force: true, recursive: true })
  }
}

/** Test-only lexical seam; do not expose through the public profile entry point. */
export async function withUnavailableTrustedGitForTest<T>(callback: () => T | Promise<T>): Promise<T> {
  const previous = trustedGitUnavailableForTest
  trustedGitUnavailableForTest = true
  try {
    return await callback()
  } finally {
    trustedGitUnavailableForTest = previous
  }
}

export function configureLocalIdentity(directory: string): void {
  git(directory, ['config', '--local', 'user.name', IDENTITY_NAME])
  git(directory, ['config', '--local', 'user.email', IDENTITY_EMAIL])
}

export function readLocalIdentity(directory: string): { name: string; email: string } {
  return {
    name: git(directory, ['config', '--local', 'user.name']),
    email: git(directory, ['config', '--local', 'user.email']),
  }
}

export function initializeRepository(directory: string): string {
  git(directory, ['init', '--quiet'])
  configureLocalIdentity(directory)
  git(directory, ['add', '--all'])
  git(directory, ['commit', '--quiet', '-m', `${ACCEPTED_PREFIX} initial template`])
  return git(directory, ['rev-parse', 'HEAD'])
}

export function acceptSnapshot(directory: string, label: string): string {
  configureLocalIdentity(directory)
  git(directory, ['add', '--all'])
  git(directory, ['commit', '--quiet', '-m', `${ACCEPTED_PREFIX} ${label}`])
  return git(directory, ['rev-parse', 'HEAD'])
}

export interface AcceptedSnapshot {
  hash: string
  subject: string
}

export function acceptedSnapshots(directory: string): AcceptedSnapshot[] {
  const output = git(directory, ['log', '--format=%H%x09%s'])
  if (output.length === 0) return []
  return output.split('\n').flatMap((line) => {
    const [hash, ...subjectParts] = line.split('\t')
    const subject = subjectParts.join('\t')
    if (!hash || !subject.startsWith(ACCEPTED_PREFIX)) return []
    return [{ hash, subject }]
  })
}

export async function hasGitDirectory(directory: string): Promise<boolean> {
  try {
    await access(join(directory, '.git'))
    return true
  } catch {
    return false
  }
}

export function rollbackToPreviousAcceptedSnapshot(directory: string): { previousSnapshot: string; rollbackCommit: string } {
  configureLocalIdentity(directory)
  const snapshots = acceptedSnapshots(directory)
  if (snapshots.length < 2) throw new Error('at least two accepted snapshots are required for rollback')
  const current = snapshots[0]
  const previous = snapshots[1]
  if (!current || !previous) throw new Error('accepted snapshot history is incomplete')
  const status = git(directory, ['status', '--porcelain'])
  if (status.length > 0) throw new Error('rollback requires a clean generated project')
  git(directory, ['revert', '--no-edit', current.hash])
  return { previousSnapshot: previous.hash, rollbackCommit: git(directory, ['rev-parse', 'HEAD']) }
}
