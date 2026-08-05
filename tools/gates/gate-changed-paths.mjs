import { execFileSync } from 'node:child_process'
import { isInChangedPathScope, main } from './lib.mjs'

function arg(name) { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1] }
function git(args) { try { return execFileSync('git', args, { encoding: 'utf8' }).trim() } catch (error) { throw new Error(`git ${args.join(' ')} failed: ${error instanceof Error ? error.message : String(error)}`) } }

await main('changed-paths', async () => {
  const base = arg('--base') ?? process.env.S2_BASE
  if (!base) throw new Error('--base or S2_BASE is required')
  git(['rev-parse', '--verify', `${base}^{commit}`])
  const mergeBases = git(['merge-base', '--all', base, 'HEAD']).split('\n').filter(Boolean)
  if (mergeBases.length !== 1) throw new Error(`expected exactly one merge base, found ${mergeBases.length}`)
  const sets = [
    git(['diff', '--name-only', `${base}...HEAD`]), git(['diff', '--name-only']), git(['diff', '--cached', '--name-only']), git(['ls-files', '--others', '--exclude-standard']),
  ]
  try { git(['diff', '--check']); git(['diff', '--cached', '--check']) } catch { throw new Error('git diff --check found whitespace errors') }
  const paths = [...new Set(sets.flatMap((value) => value.split('\n').filter(Boolean)))].sort()
  const bad = paths.filter((path) => !isInChangedPathScope(path))
  if (bad.length) throw new Error(`out-of-scope changed paths: ${bad.join(', ')}`)
  return { base, mergeBase: mergeBases[0], changedPaths: paths, count: paths.length }
})
