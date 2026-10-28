// scripts/preview.mjs — `vite preview` that tolerates the npm/pnpm `--`
// separator (frozen tests call `pnpm run preview -- --port 4178 --strictPort`;
// vite's CLI stops option parsing at `--`, so filter it out and delegate).

import { spawn, spawnSync, execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
// vite's exports map hides bin/vite.js; resolve through the package main.
const viteBin = join(dirname(require.resolve('vite')), '..', '..', 'bin', 'vite.js')
const args = process.argv.slice(2).filter((arg) => arg !== '--')

// If a previous preview from THIS script still holds the port (stale test
// harness kills can outlive the 300 ms stop window), preempt it deterministically.
// Never touch a process that is not one of our own vite previews — then
// --strictPort still surfaces genuine conflicts.
const portArg = args.find((a, i) => (a === '--port' || a === '-p') && args[i + 1])
const port = portArg ? args[args.indexOf(portArg) + 1] : undefined
if (port) preemptStaleVite(port)

const child = spawn(process.execPath, [viteBin, 'preview', ...args], { stdio: 'inherit' })
child.on('exit', (code, signal) => {
  if (process.env.ZIPSCRIBE_PREVIEW_DEBUG) console.error('[preview.mjs] vite exited', code, signal)
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
// Tests stop preview by killing this wrapper — the vite grandchild must go too,
// or an orphaned server answers on the port for the next test.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    child.kill(signal)
    process.exit(128)
  })
}
// Tests stop preview by killing the `corepack pnpm run` wrapper — but pnpm's
// intermediate processes can outlive it, orphaning the vite grandchild on the
// port. Watch the full ancestor chain (this process → sh → pnpm → corepack →
// test runner) and tear the server down the moment any ancestor disappears.
// The chain is (re)snapshotted after a settle delay: pnpm's launcher processes
// are ephemeral and must not count as watched ancestors.
function ancestorChain() {
  const pids = []
  let pid = process.pid
  for (let hop = 0; hop < 8; hop++) {
    const ps = spawnSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' })
    if (ps.status !== 0) break
    const next = Number(ps.stdout.trim())
    if (!next || next === pid || next === 0) break
    pids.push(next)
    pid = next
  }
  return pids
}
let ancestors = ancestorChain()
const parentPid = process.ppid
let watchdog
const startWatchdog = () => {
  watchdog = setInterval(() => {
    const chainBroken = process.ppid !== parentPid || ancestors.some((pid) => !alive(pid))
    if (chainBroken) {
      // SIGKILL: the port must be released within the test's 300 ms stop window.
      if (process.env.ZIPSCRIBE_PREVIEW_DEBUG)
        console.error(
          '[preview.mjs] watchdog kill: ppid changed?',
          process.ppid !== parentPid,
          'dead ancestor?',
          ancestors.some((pid) => !alive(pid)),
          'ancestors:',
          ancestors.map((pid) => `${pid}${alive(pid) ? 'Y' : 'N'}`).join(','),
        )
      child.kill('SIGKILL')
      clearInterval(watchdog)
      process.exit(0)
    }
  }, 30)
  watchdog.unref()
}
// Start watching only once the launcher processes have settled, and
// re-snapshot then so ephemeral pids cannot kill a healthy server.
setTimeout(() => {
  ancestors = ancestorChain()
  startWatchdog()
}, 400).unref()

function preemptStaleVite(port) {
  let out = ''
  try {
    out = execSync(`lsof -nP -tiTCP:${port} -sTCP:LISTEN`, { encoding: 'utf8' }).trim()
  } catch {
    return // port free
  }
  for (const line of out.split('\n').filter(Boolean)) {
    const pid = Number(line)
    if (!pid) continue
    let cmd = ''
    try {
      cmd = execSync(`ps -p ${pid} -o command=`, { encoding: 'utf8' })
    } catch {
      continue
    }
    if (cmd.includes('vite.js preview') || cmd.includes('preview.mjs')) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // already gone
      }
    }
  }
}

function alive(pid) {
  if (pid <= 1) return true // launchd is immortal (and signaling it is EPERM)
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error && typeof error === 'object' && error.code === 'EPERM' // exists, not ours
  }
}
