import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const candidates = [
  process.env.TSC_PATH,
  join(process.cwd(), 'node_modules', 'typescript', 'bin', 'tsc'),
  'D:\\deepseek-harness\\node_modules\\typescript\\bin\\tsc',
].filter(path => path && existsSync(path))

if (candidates.length === 0) {
  console.error('TypeScript compiler not found. Set TSC_PATH or provide a local TypeScript installation.')
  process.exit(1)
}

const result = spawnSync(process.execPath, [candidates[0], '--noEmit', '-p', 'tsconfig.json'], { stdio: 'inherit' })
process.exit(result.status ?? 1)
