import { resolve } from 'node:path'
import { runM5ACanary } from '../../src/milestone5a/canary.ts'

const args = process.argv.slice(2)
const mode = args[0]
const inputIndex = args.indexOf('--input-run')
const outputIndex = args.indexOf('--output-root')
const inputRun = inputIndex >= 0 ? args[inputIndex + 1] : undefined
const outputRoot = outputIndex >= 0 ? args[outputIndex + 1] : undefined
if (!['--dry-run', '--live'].includes(mode) || !inputRun || (inputIndex >= 0 && !args[inputIndex + 1])) {
  console.error('Usage: node examples/evaluation/m5a-gap-generation.mjs --dry-run|--live --input-run <persisted-run> [--output-root <directory>]')
  process.exitCode = 2
} else {
  const result = await runM5ACanary({ mode: mode === '--live' ? 'live' : 'dry-run', inputRun: resolve(inputRun), outputRoot: outputRoot ? resolve(outputRoot) : undefined })
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exitCode = 1
}
