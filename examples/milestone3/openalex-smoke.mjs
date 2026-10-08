import { OpenAlexProvider, planQueries } from '../../src/literature/index.ts'
const provider = new OpenAlexProvider()
const [query] = planQueries([{ needId: 'smoke', originNodeIds: [], goal: 'machine learning', concepts: ['machine', 'learning'], constraints: [], priority: 1, reason: 'optional smoke test' }])
const result = await provider.search(query, { limit: 3 })
console.log(JSON.stringify({ coverage: result.coverage, selectedSources: result.records }, null, 2))
