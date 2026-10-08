import { resolve } from 'node:path'
import { dryRunCase, runLiveCase, validateStopAfter } from '../../src/coordinator/live-validation.ts'

const args = process.argv.slice(2)
const mode = args[0]
let stopAfter
let casePath
const enableGeneration0 = args.includes('--generation-0')
const positional = args.filter(arg => arg !== '--generation-0')
if (positional[1] === '--stop-after') { stopAfter = positional[2]; casePath = positional[3] } else { casePath = positional[1] }
let stopError
try { stopAfter = validateStopAfter(stopAfter) } catch (error) { stopError = error instanceof Error ? error.message : String(error) }
if (!mode || !['--dry-run', '--live'].includes(mode) || !casePath || positional.length !== (stopAfter ? 4 : 2) || stopError) {
  console.error(stopError ?? 'Usage: node examples/evaluation/live-validation.mjs --dry-run|--live [--generation-0] [--stop-after STAGE] evaluation/real-paper/cases/first-three/case.json')
  process.exitCode = 2
} else if (mode === '--dry-run') {
  const result = dryRunCase(resolve(casePath), { stopAfter, enableGeneration0 })
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exitCode = 1
} else {
  const result = await runLiveCase(resolve(casePath), { stopAfter, enableGeneration0 })
  console.log(JSON.stringify(result, null, 2))
  if (result.failedStage || result.status === 'FAILED') process.exitCode = 1
}
