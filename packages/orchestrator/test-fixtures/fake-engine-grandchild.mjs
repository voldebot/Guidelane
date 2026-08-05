import { execFileSync, spawn } from 'node:child_process'
import { rename, writeFile } from 'node:fs/promises'

const [receiptPath, mode] = process.argv.slice(2)
if (!receiptPath) throw new Error('receipt path is required')

if (mode !== '--engine') {
  // This is the supervisor. Its engine is a separate process group, so killing
  // the supervisor leaves the receipt target alive for identity verification.
  spawn(process.execPath, [process.argv[1], receiptPath, '--engine'], { detached: true, stdio: 'ignore' }).unref()
  setInterval(() => {}, 1000)
} else {
  // The child deliberately stays in this detached engine group. A bare-pid kill
  // of the direct engine will leave this process running, which is the regression
  // this fixture is meant to make observable.
  const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  })
  const startIdentity = execFileSync('ps', ['-o', 'lstart=', '-p', String(process.pid)], { encoding: 'utf8' }).trim()
  const receipt = JSON.stringify({ attemptId: 'attempt-orphaned', pgid: process.pid, pid: process.pid, grandchildPid: grandchild.pid, startIdentity })
  const temporaryReceiptPath = `${receiptPath}.${process.pid}.tmp`
  await writeFile(temporaryReceiptPath, receipt, 'utf8')
  await rename(temporaryReceiptPath, receiptPath)
  setInterval(() => {}, 1000)
}
