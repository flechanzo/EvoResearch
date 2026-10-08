import { preflightPyMuPDF } from '../../src/adapters/python-runtime.ts'
try {
  const runtime = preflightPyMuPDF()
  console.log(JSON.stringify(runtime, null, 2))
  if (!runtime.pymupdfAvailable) process.exitCode = 1
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
