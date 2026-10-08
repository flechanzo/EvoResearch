import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { normalizeQueryTerms, scoreLiteratureCandidate, selectSourcesForMembership, validateLiteratureQueryMembership, validateSourceSelection } from '../src/literature/index.ts'

export const referenceRun = 'evaluation/real-paper/cases/first-three/outputs/run-2026-10-03T12-42-31-800Z-c2dadfeb'
export const regressionFixture = 'evaluation/relevance/source-select-regression.json'

// Frozen pre-fix formula, used only for offline comparison with historical state.
export function oldCandidateScore(record, query) {
  const terms = query.query.toLowerCase().split(/\s+/).filter(Boolean)
  const text = `${record.title} ${record.abstract ?? ''}`.toLowerCase()
  const matchedTerms = terms.filter(term => text.includes(term))
  const identifierBonus = record.doi ? 3 : record.openAlexId || record.arxivId ? 2 : record.urls.length ? 1 : 0
  const dateBonus = query.corpusCutoff && record.publicationDate && record.publicationDate <= query.corpusCutoff ? 1 : 0
  const lexicalScore = matchedTerms.length * 10
  return { matchedTerms, lexicalScore, identifierBonus, dateBonus, totalScore: lexicalScore + identifierBonus + dateBonus }
}

function tieCounts(ranked) {
  const counts = new Map()
  for (const row of ranked) counts.set(row.score, (counts.get(row.score) ?? 0) + 1)
  const tied = [...counts.values()].filter(count => count > 1)
  return { groups: tied.length, candidates: tied.reduce((a, b) => a + b, 0), pairs: tied.reduce((a, b) => a + b * (b - 1) / 2, 0) }
}

function concentration(queries, field) {
  const counts = new Map()
  for (const q of queries) for (const id of q[field]) counts.set(id, (counts.get(id) ?? 0) + 1)
  return { uniqueSelectedRecords: counts.size, repeatedRecords: [...counts.values()].filter(n => n > 1).length,
    maximumQueryPathsPerRecord: Math.max(0, ...counts.values()), repeated: [...counts].filter(([, n]) => n > 1).map(([literatureId, queryPaths]) => ({ literatureId, queryPaths })) }
}

export function compareSourceSelections(runDirectory = referenceRun) {
  const run = resolve(runDirectory)
  const inputHashes = {}
  const read = name => {
    const bytes = readFileSync(resolve(run, name))
    inputHashes[name] = createHash('sha256').update(bytes).digest('hex')
    return JSON.parse(bytes)
  }
  const snapshot = read('run-snapshot.json')
  const queries = read('literature-queries.json'), memberships = read('literature-query-membership.json')
  const records = read('literature-records.json'), selections = read('source-selection.json')
  const coverages = read('search-coverage.json'), needs = read('retrieval-needs.json')
  const fixture = JSON.parse(readFileSync(resolve(regressionFixture)))
  const additionalArtifacts = [
    'claims.json', 'config.json', 'evaluation-report.json', 'evidence-graph.json', 'evidence-plan.json',
    'evidence.json', 'extraction-report.json', 'ingest.json', 'model-attempts.json', 'model-preflight.json',
    'problem-graph.json', 'report.md', 'stage-state.json',
    'paper-reader/gaussian-shading-plus-plus.json', 'paper-reader/gaussian-shading.json', 'paper-reader/tag-wm.json',
    'problem-extractor/gaussian-shading-plus-plus.json', 'problem-extractor/gaussian-shading.json', 'problem-extractor/tag-wm.json',
  ]
  for (const name of additionalArtifacts) {
    inputHashes[name] = createHash('sha256').update(readFileSync(resolve(run, name))).digest('hex')
  }
  const recordsById = new Map(records.map(record => [record.literatureId, record]))
  const limit = snapshot.budgets.maxSelectedSourcesPerRetrievalNeed
  const comparison = queries.map(query => {
    const membership = memberships.find(item => item.queryId === query.queryId)
    const coverage = coverages.find(item => item.queryId === query.queryId)
    const need = needs.find(item => item.needId === query.needId)
    const selection = selections.find(item => item.queryId === query.queryId)
    validateLiteratureQueryMembership(membership, query, coverage, recordsById)
    const candidates = membership.literatureIds.map(id => recordsById.get(id))
    const rows = candidates.map(record => ({ literatureId: record.literatureId, title: record.title,
      old: oldCandidateScore(record, query), new: scoreLiteratureCandidate(record, query) }))
    const rank = field => rows.map(row => ({ id: row.literatureId, score: row[field].totalScore }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    const oldRanks = rank('old'), newRanks = rank('new')
    const selectable = membership.status !== 'FAILED' && membership.status !== 'NO_RESULTS'
    const oldTopK = selectable ? oldRanks.slice(0, limit).map(row => row.id) : []
    const newTopK = selectSourcesForMembership(query, membership, recordsById, limit).map(record => record.literatureId)
    assert.deepEqual(oldTopK, selection.records.map(record => record.literatureId), `old replay differs from historical selection: ${query.queryId}`)
    assert.deepEqual(newTopK, selectable ? newRanks.slice(0, limit).map(row => row.id) : [])
    validateSourceSelection({ ...selection, records: newTopK.map(id => recordsById.get(id)) }, query, need, coverage, membership, recordsById)
    const oldIndex = new Map(oldRanks.map((row, index) => [row.id, index + 1]))
    const newIndex = new Map(newRanks.map((row, index) => [row.id, index + 1]))
    return {
      queryId: query.queryId, retrievalNeedId: query.needId, originalQuery: query.query,
      normalizedQueryTokens: normalizeQueryTerms(query.query).tokens, removedStopwords: normalizeQueryTerms(query.query).removedStopwords,
      coverageStatus: coverage.status, candidateCount: candidates.length, oldTopK, newTopK,
      removedSelections: oldTopK.filter(id => !newTopK.includes(id)), addedSelections: newTopK.filter(id => !oldTopK.includes(id)),
      oldTies: tieCounts(oldRanks), newTies: tieCounts(newRanks),
      warning: query.queryId === 'query_a0dbca3b483ee2dd26900d7c' ? 'UPSTREAM_QUERY_QUALITY_WARNING: operator verification/traceability lacks watermarking/domain anchors; normalization cannot supply them.' : undefined,
      candidates: rows.map(row => ({ ...row, oldRank: oldIndex.get(row.literatureId), newRank: newIndex.get(row.literatureId),
        rankChange: oldIndex.get(row.literatureId) - newIndex.get(row.literatureId), oldSelected: oldTopK.includes(row.literatureId), newSelected: newTopK.includes(row.literatureId) })),
    }
  })
  const selectedRows = comparison.reduce((sum, q) => sum + q.oldTopK.length, 0)
  const retainedRows = comparison.reduce((sum, q) => sum + q.oldTopK.filter(id => q.newTopK.includes(id)).length, 0)
  const sumTies = field => Object.fromEntries(['groups', 'candidates', 'pairs'].map(key => [key, comparison.reduce((sum, q) => sum + q[field][key], 0)]))
  const benchmarkCases = fixture.cases.map(item => {
    const query = comparison.find(candidate => candidate.queryId === item.queryId)
    const candidate = query?.candidates.find(row => row.literatureId === item.literatureId)
    assert.ok(query && candidate, `regression fixture case is absent from replay: ${item.caseId}`)
    return { ...item, oldRank: candidate.oldRank, newRank: candidate.newRank, oldScore: candidate.old.totalScore, newScore: candidate.new.totalScore, oldSelected: candidate.oldSelected, newSelected: candidate.newSelected }
  })
  const benchmarkSummary = {
    clearlyBadLexicalCollisionsRemoved: benchmarkCases.filter(item => /irrelevant|generic/i.test(item.annotation) && item.oldSelected && !item.newSelected).map(item => item.caseId),
    clearlyBadLexicalCollisionsRetained: benchmarkCases.filter(item => /irrelevant|generic/i.test(item.annotation) && item.oldSelected && item.newSelected).map(item => item.caseId),
    apparentlyRelevantCandidatesLost: benchmarkCases.filter(item => /clearly relevant|phrase-sensitive|legitimate shared/i.test(item.annotation) && item.oldSelected && !item.newSelected).map(item => item.caseId),
    ambiguousChangesRequiringLaterEvaluation: benchmarkCases.filter(item => /weak|low-information/i.test(item.annotation) && item.oldSelected !== item.newSelected).map(item => item.caseId),
  }
  return { runId: snapshot.runId, sourceDirectory: relative(process.cwd(), run).replaceAll('\\', '/'), inputHashes,
    policy: { tokenizer: 'lowercase Unicode letter/number sequences', distinctQueryTokens: true, score: '10 * matched distinct non-stopword tokens + unchanged identifier/date bonuses', limit, threshold: 'none', tieBreak: 'literatureId.localeCompare' },
    summary: {
      queries: comparison.length, queryLocalCandidatePaths: comparison.reduce((sum, q) => sum + q.candidateCount, 0), canonicalRecords: records.length,
      selectedRows, retainedRows, topKOverlap: `${retainedRows}/${selectedRows}`, changedQueries: comparison.filter(q => q.removedSelections.length || q.addedSelections.length).length,
      replacedSelectedRows: selectedRows - retainedRows, changedSelectedRows: (selectedRows - retainedRows) * 2,
      zeroCandidateQueries: comparison.filter(q => q.candidateCount === 0).length, oldZeroSelectionQueries: comparison.filter(q => !q.oldTopK.length).length,
      newZeroSelectionQueries: comparison.filter(q => !q.newTopK.length).length,
      zeroLexicalOverlapQueries: comparison.filter(q => q.candidates.length && q.candidates.every(row => row.new.lexicalScore === 0)).map(q => q.queryId),
      oldTies: sumTies('oldTies'), newTies: sumTies('newTies'), oldConcentration: concentration(comparison, 'oldTopK'), newConcentration: concentration(comparison, 'newTopK'),
      benchmark: benchmarkSummary,
    }, benchmark: { fixtureType: fixture.fixtureType, annotationsAreRankingDiagnostics: fixture.annotationsAreRankingDiagnostics, cases: benchmarkCases }, queries: comparison,
  }
}

export function renderComparison(report) {
  const lines = ['# Offline SOURCE_SELECT ranking comparison', '', `Reference run: ${report.runId}. Read-only replay; no retrieval or scientific evidence generation.`, '',
    'Ranking annotations are audit judgments, not scientific evidence or relevance ground truth.', '', '## Aggregate comparison', '', '```json', JSON.stringify(report.summary, null, 2), '```', '',
    'Score ties count equal **total scores** across all local candidates. Groups count repeated scores; pairs count unordered tied candidate pairs. Changed rows count both removed and added selections.', '',
    '## Per-query comparison', '', '| Query | Candidates | Retained/top-k | Replacements | Tied pairs old → new |', '|---|---:|---:|---:|---:|']
  for (const q of report.queries) lines.push(`| ${q.queryId} | ${q.candidateCount} | ${q.oldTopK.filter(id => q.newTopK.includes(id)).length}/${q.oldTopK.length} | ${q.removedSelections.length} | ${q.oldTies.pairs} → ${q.newTies.pairs} |`)
  for (const q of report.queries) {
    lines.push('', `## ${q.queryId}`, '', `Retrieval need: ${q.retrievalNeedId}`, '', `Query: ${q.originalQuery}`, '',
      `Normalized tokens: ${q.normalizedQueryTokens.join(', ') || '(none)'}`, '', `Removed stopwords: ${q.removedStopwords.join(', ') || '(none)'}`, '',
      ...(q.warning ? [q.warning, ''] : []), 'Old top-k: '+q.oldTopK.join(', '), '', 'New top-k: '+q.newTopK.join(', '), '',
      '| Candidate | ID | Old rank / score | New rank / score | Selection old → new | New matched tokens |', '|---|---|---:|---:|---|---|')
    for (const row of [...q.candidates].sort((a, b) => a.oldRank - b.oldRank)) lines.push(`| ${row.title.replaceAll('|', '\\|')} | ${row.literatureId} | ${row.oldRank} / ${row.old.totalScore} | ${row.newRank} / ${row.new.totalScore} | ${row.oldSelected} → ${row.newSelected} | ${row.new.matchedTokens.join(', ') || '(none)'} |`)
  }
  lines.push('', '## Interpretation and remaining limitations', '',
    'The patch removes function-word, duplicate-token and substring points only. It does not establish scientific relevance, restore omitted query context, resolve morphology, add phrase matching, or suppress scientifically broad terms.', '',
    'The Q12 operator-verification query remains an UPSTREAM_QUERY_QUALITY_WARNING. No domain anchors are invented, and no score threshold empties its candidate path.', '',
    'Full score decompositions, input artifact SHA-256 hashes, per-candidate rank changes, and the benchmark outcome classification are in the companion JSON. Representative audit annotations are in source-select-regression.json.')
  return lines.join('\n') + '\n'
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const run = resolve(process.argv[2] ?? referenceRun)
  const output = resolve(process.argv[3] ?? 'evaluation/relevance/source-select-comparison.json')
  if (output === run || output.startsWith(run + '\\') || output.startsWith(run + '/')) throw new Error('comparison output must be outside the historical run')
  const report = compareSourceSelections(run)
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
  writeFileSync(output.replace(/\.json$/, '') + '.md', renderComparison(report))
  console.log(JSON.stringify(report.summary, null, 2))
}
