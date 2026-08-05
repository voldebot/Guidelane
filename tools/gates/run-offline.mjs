import { main, runOffline } from './lib.mjs'

const separator = process.argv.indexOf('--')
const [command, ...args] = separator < 0 ? [] : process.argv.slice(separator + 1)
await main('offline-runner', async () => {
  if (!command) throw new Error('usage: run-offline.mjs [--artifacts DIR] -- <command> [args...]')
  await runOffline(command, args)
  return { child: { command, args }, environment: { CI: '1', liveVariablesRemoved: true } }
})
