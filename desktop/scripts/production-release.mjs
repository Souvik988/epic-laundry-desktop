import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertProductionEnvironment } from './production-release-guard.mjs'

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = { ...process.env, EPIC_RELEASE_CHANNEL: 'production' }
const packageJson = JSON.parse(await fs.readFile(path.join(desktopDir, 'package.json'), 'utf8'))
const release = assertProductionEnvironment(env, packageJson)

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: desktopDir, env, stdio: 'inherit', shell: process.platform === 'win32' })
    child.on('error', reject)
    child.on('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code ?? signal}`)))
  })
}

const builderConfig = path.join(os.tmpdir(), `epic-laundry-production-builder-${process.pid}.json`)
await fs.writeFile(builderConfig, `${JSON.stringify({ win: { signAndEditExecutable: true }, publish: [{ provider: 'generic', url: release.updateFeed }] }, null, 2)}\n`, 'utf8')
try {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const builder = process.platform === 'win32' ? 'node_modules/.bin/electron-builder.cmd' : 'node_modules/.bin/electron-builder'
  await run(npm, ['run', 'build:server'])
  await run(builder, ['--win', '--config', builderConfig])
  await run(process.execPath, ['scripts/release-manifest.mjs'])
  await run(process.execPath, ['scripts/verify-release-manifest.mjs'])
  await run(process.execPath, ['scripts/sign-release-manifest.mjs'])
  await run(process.execPath, ['scripts/verify-release-signature.mjs'])
  console.log(`Production release completed for Epic Laundry ${release.version}`)
} finally {
  await fs.rm(builderConfig, { force: true })
}
