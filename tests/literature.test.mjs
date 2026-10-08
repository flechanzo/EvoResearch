import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { normalizeDoi, normalizeLiterature, deriveRetrievalNeeds, planQueries, selectSources, selectSourcesForMembership, makeCoverage, makeLiteratureQueryMembership, validateLiteratureQueryMembership, validateSourceSelection, scoreLiteratureCandidate, normalizeQueryTerms, EvidenceGraph, OpenAlexProvider } from '../src/literature/index.ts'

test('literature identity normalizes DOI and preserves ambiguous records', () => {
  assert.equal(normalizeDoi('https://doi.org/10.1234/ABC.'), '10.1234/abc')
  const a = normalizeLiterature({ title: 'Same Title', authors: [], doi: '10.1/x', provider: 'a', providerId: 'A1', retrievedAt: '2026-09-28T00:00:00Z' })
  const b = normalizeLiterature({ title: 'Same Title', authors: [], provider: 'b', providerId: 'B1', retrievedAt: '2026-09-28T00:00:00Z' })
  assert.notEqual(a.literatureId, b.literatureId)
})

test('retrieval needs and queries are bounded and deduplicated', () => {
  const graph = { problems: [], nodes: [{ nodeId: 'n1', type: 'open-question', label: 'Robust training data', evidenceIds: [] }, { nodeId: 'n2', type: 'open-question', label: 'Robust training data', evidenceIds: [] }], edges: [] }
  const needs = deriveRetrievalNeeds(graph, '2020-12-31')
  assert.equal(needs.length, 2)
  const queries = planQueries(needs, 'fake', 1)
  assert.equal(queries.length, 1)
  assert.equal(queries[0].corpusCutoff, '2020-12-31')
})

test('coverage NO_RESULTS is an attempt outcome, never a novelty claim', () => {
  const coverage = makeCoverage({ queryId: 'q1', provider: 'fake', query: 'nothing', filters: {}, requestedLimit: 5, returnedCount: 0, examinedCount: 0, acceptedCount: 0, duplicateCount: 0, futureExcludedCount: 0, failedFetchCount: 0, timestamp: '2026-09-28T00:00:00Z', status: 'NO_RESULTS', diagnostics: [] })
  assert.equal(coverage.status, 'NO_RESULTS')
  assert.equal('novelty' in coverage, false)
})

test('temporal cutoff uses provider filtering and excludes future and unknown OpenAlex dates', async () => {
  const urls = []
  const fakeFetch = async url => { urls.push(String(url)); return new Response(JSON.stringify({ results: [
    { id: 'https://openalex.org/W1', title: 'Old', publication_year: 2020, publication_date: '2020-01-01', authorships: [], ids: { openalex: 'W1' } },
    { id: 'https://openalex.org/W2', title: 'Equal', publication_year: 2022, publication_date: '2022-01-01', authorships: [], ids: { openalex: 'W2' } },
    { id: 'https://openalex.org/W3', title: 'Future', publication_year: 2022, publication_date: '2022-01-02', authorships: [], ids: { openalex: 'W3' } },
    { id: 'https://openalex.org/W4', title: 'Missing', publication_year: 2022, authorships: [], ids: { openalex: 'W4' } },
    { id: 'https://openalex.org/W5', title: 'Malformed', publication_year: 2022, publication_date: '2022-02-31', authorships: [], ids: { openalex: 'W5' } }
  ] }), { status: 200, headers: { 'content-type': 'application/json' } }) }
  const provider = new OpenAlexProvider(fakeFetch)
  const result = await provider.search({ queryId: 'q', needId: 'n', query: 'topic', provider: 'openalex', filters: {}, corpusCutoff: '2022-01-01', reason: 'test', attempt: 1 }, { limit: 20, timeoutMs: 3210 })
  assert.equal(result.records.length, 2)
  assert.equal(result.coverage.futureExcludedCount, 1)
  assert.equal(result.coverage.unknownDateCount, 2)
  assert.equal(result.coverage.unknownDatePolicy, 'EXCLUDE_FROM_CUTOFF_CORPUS')
  assert.equal(result.coverage.filters.filter, 'to_publication_date:2022-01-01')
  assert.equal(result.coverage.acceptedCount, 2)
  assert.equal(result.coverage.timeoutMs, 3210)
  assert.equal(result.coverage.maxAttempts, 2)
  assert.equal(result.coverage.retryPolicy, 'RETRY_ONCE_AFTER_50MS')
  const requestUrl = new URL(urls[0])
  assert.equal(requestUrl.searchParams.get('filter'), 'to_publication_date:2022-01-01')
  assert.equal(requestUrl.searchParams.get('per-page'), '20')
  assert.equal(requestUrl.searchParams.get('mailto'), null)
  const failed = new OpenAlexProvider(async () => { throw new Error('offline') })
  assert.equal((await failed.search({ queryId: 'q2', needId: 'n', query: 'topic', provider: 'openalex', filters: {}, corpusCutoff: '2022-01-01', reason: 'test', attempt: 1 })).coverage.status, 'FAILED')
})

test('missing corpusCutoff fails closed before the provider request', async () => {
  let fetchCalls = 0
  const provider = new OpenAlexProvider(async () => { fetchCalls++; throw new Error('network must not be reached') })
  await assert.rejects(() => provider.search({ queryId: 'q', needId: 'n', query: 'topic', provider: 'openalex', filters: {}, reason: 'test', attempt: 1 }), /corpusCutoff.*required/i)
  assert.equal(fetchCalls, 0)
})

test('offline SOURCE_SELECT replay consumes the sanitized 38-record literature shape', () => {
  const corpusCutoff = '2026-09-29'
  const needs = Array.from({ length: 12 }, (_, index) => ({ needId: `need_${index}`, goal: `watermark robustness ${index}`, concepts: ['watermark', 'robustness'], constraints: [], priority: 1, reason: 'sanitized replay', originNodeIds: [] }))
  const queries = needs.map((need, index) => ({ queryId: `query_${index}`, needId: need.needId, query: 'watermark robustness', provider: 'openalex', filters: { filter: `to_publication_date:${corpusCutoff}` }, corpusCutoff, reason: need.reason, attempt: 1 }))
  const coverage = queries.map((query, index) => makeCoverage({ queryId: query.queryId, provider: 'openalex', query: query.query, filters: query.filters, corpusCutoff, requestedLimit: 20, returnedCount: index < 2 ? 20 : 0, examinedCount: index < 2 ? 20 : 0, acceptedCount: index < 2 ? 20 : 0, duplicateCount: 0, futureExcludedCount: 0, failedFetchCount: index < 2 ? 0 : 2, timestamp: `2026-09-29T13:42:${String(index).padStart(2, '0')}.000Z`, status: index < 2 ? 'COMPLETE' : 'FAILED', diagnostics: index < 2 ? [] : ['OpenAlex HTTP 429'] }))
  assert.equal(coverage.filter(item => item.status === 'COMPLETE').length, 2)
  assert.equal(coverage.filter(item => item.status === 'FAILED').length, 10)
  const records = Array.from({ length: 38 }, (_, index) => normalizeLiterature({ title: `Watermark robustness study ${index}`, authors: ['Sanitized Author'], year: 2020 + (index % 6), publicationDate: `${2020 + (index % 6)}-0${(index % 9) + 1}-0${(index % 9) + 1}`, abstract: 'watermark robustness results', doi: `10.1000/sanitized-${index}`, openAlexId: `https://openalex.org/Wsanitized${index}`, urls: [`https://openalex.org/Wsanitized${index}`], provider: 'openalex', providerId: `https://openalex.org/Wsanitized${index}`, retrievedAt: '2026-09-29T13:42:26.410Z' }))
  const rawRecords = [...records, records[0], records[20]]
  const uniqueRecords = [...new Map(rawRecords.map(record => [record.literatureId, record])).values()]
  assert.equal(rawRecords.length, 40)
  assert.equal(uniqueRecords.length, 38)

  const future = normalizeLiterature({ title: 'Future paper', authors: [], publicationDate: '2026-09-30', abstract: 'watermark robustness', openAlexId: 'https://openalex.org/Wfuture', provider: 'openalex', providerId: 'https://openalex.org/Wfuture', retrievedAt: '2026-09-29T13:42:26.410Z' })
  const unknown = normalizeLiterature({ title: 'Undated paper', authors: [], abstract: 'watermark robustness', openAlexId: 'https://openalex.org/Wunknown', provider: 'openalex', providerId: 'https://openalex.org/Wunknown', retrievedAt: '2026-09-29T13:42:26.410Z' })
  const recordsByQuery = new Map([
    [queries[0].queryId, [...uniqueRecords.slice(0, 20), future, unknown]],
    [queries[1].queryId, uniqueRecords.slice(20)],
  ])
  const coverageByQuery = new Map(coverage.map(item => [item.queryId, item]))
  const queryById = new Map(queries.map(query => [query.queryId, query]))
  const needIds = new Set(needs.map(need => need.needId))
  assert.equal(coverage.every(item => queryById.has(item.queryId)), true)
  assert.equal(queries.every(query => needIds.has(query.needId)), true)

  const replay = () => queries.map(query => {
    const attempt = coverageByQuery.get(query.queryId)
    const candidates = attempt?.status === 'COMPLETE' ? (recordsByQuery.get(query.queryId) ?? []) : []
    return { queryId: query.queryId, needId: query.needId, records: selectSources(candidates, query, 5) }
  })
  const first = replay()
  const second = replay()
  assert.deepEqual(first, second)
  assert.deepEqual(first.slice(0, 2).map(item => item.records.length), [5, 5])
  assert.equal(first.slice(2).every(item => item.records.length === 0), true)
  assert.equal(first.flatMap(item => item.records).every(record => record.publicationDateStatus === 'KNOWN' && record.publicationDate <= corpusCutoff), true)
  assert.equal(first.flatMap(item => item.records).some(record => record.literatureId === future.literatureId || record.literatureId === unknown.literatureId), false)
  assert.equal(first.flatMap(item => item.records).every(record => uniqueRecords.some(candidate => candidate.literatureId === record.literatureId)), true)
  assert.equal(first.flatMap(item => item.records).every(record => typeof record.providerRecords.openalex === 'string'), true)
})

test('query-local memberships keep disjoint and shared canonical records separate', () => {
  const cutoff = '2026-09-29'
  const needA = { needId: 'need_a', originNodeIds: ['node_a'], goal: 'alpha', concepts: ['alpha'], constraints: [], priority: 1, reason: 'test', corpusCutoff: cutoff }
  const needB = { needId: 'need_b', originNodeIds: ['node_b'], goal: 'beta', concepts: ['beta'], constraints: [], priority: 1, reason: 'test', corpusCutoff: cutoff }
  const queryA = { queryId: 'query_a', needId: needA.needId, query: 'alpha', provider: 'openalex', filters: {}, corpusCutoff: cutoff, reason: 'test', attempt: 1 }
  const queryB = { queryId: 'query_b', needId: needB.needId, query: 'beta', provider: 'openalex', filters: {}, corpusCutoff: cutoff, reason: 'test', attempt: 1 }
  const alpha = normalizeLiterature({ title: 'Alpha paper', authors: [], publicationDate: '2024-01-01', abstract: 'alpha result', doi: '10.1000/alpha', openAlexId: 'https://openalex.org/Walpha', provider: 'openalex', providerId: 'https://openalex.org/Walpha', retrievedAt: cutoff })
  const beta = normalizeLiterature({ title: 'Beta paper', authors: [], publicationDate: '2024-01-01', abstract: 'beta result', doi: '10.1000/beta', openAlexId: 'https://openalex.org/Wbeta', provider: 'openalex', providerId: 'https://openalex.org/Wbeta', retrievedAt: cutoff })
  const shared = normalizeLiterature({ title: 'Shared paper', authors: [], publicationDate: '2024-01-01', abstract: 'alpha beta result', doi: '10.1000/shared', openAlexId: 'https://openalex.org/Wshared', provider: 'openalex', providerId: 'https://openalex.org/Wshared', retrievedAt: cutoff })
  const coverageA = makeCoverage({ queryId: queryA.queryId, provider: 'openalex', query: queryA.query, filters: {}, corpusCutoff: cutoff, requestedLimit: 20, returnedCount: 2, examinedCount: 2, acceptedCount: 2, duplicateCount: 0, futureExcludedCount: 0, failedFetchCount: 0, timestamp: '2026-09-29T00:00:00Z', status: 'COMPLETE', diagnostics: [] })
  const coverageB = makeCoverage({ queryId: queryB.queryId, provider: 'openalex', query: queryB.query, filters: {}, corpusCutoff: cutoff, requestedLimit: 20, returnedCount: 2, examinedCount: 2, acceptedCount: 2, duplicateCount: 0, futureExcludedCount: 0, failedFetchCount: 0, timestamp: '2026-09-29T00:00:01Z', status: 'COMPLETE', diagnostics: [] })
  const corpus = new Map([alpha, beta, shared].map(record => [record.literatureId, record]))
  const membershipA = makeLiteratureQueryMembership(queryA, coverageA, [alpha, shared])
  const membershipB = makeLiteratureQueryMembership(queryB, coverageB, [beta, shared])
  validateLiteratureQueryMembership(membershipA, queryA, coverageA, corpus); validateLiteratureQueryMembership(membershipB, queryB, coverageB, corpus)
  const selectedA = selectSourcesForMembership(queryA, membershipA, corpus, 5); const selectedB = selectSourcesForMembership(queryB, membershipB, corpus, 5)
  assert.deepEqual(new Set(selectedA.map(record => record.literatureId)), new Set([alpha.literatureId, shared.literatureId]))
  assert.deepEqual(new Set(selectedB.map(record => record.literatureId)), new Set([beta.literatureId, shared.literatureId]))
  assert.equal(new Set([...membershipA.literatureIds, ...membershipB.literatureIds]).size, 3)
})

test('FAILED and NO_RESULTS memberships cannot borrow or carry literature', () => {
  const query = { queryId: 'query_failed', needId: 'need_failed', query: 'topic', provider: 'openalex', filters: {}, corpusCutoff: '2026-09-29', reason: 'test', attempt: 1 }
  const record = normalizeLiterature({ title: 'Topic', authors: [], publicationDate: '2024-01-01', abstract: 'topic', openAlexId: 'https://openalex.org/Wtopic', provider: 'openalex', providerId: 'https://openalex.org/Wtopic', retrievedAt: '2026-09-29T00:00:00Z' })
  const failed = makeCoverage({ queryId: query.queryId, provider: 'openalex', query: query.query, filters: {}, corpusCutoff: query.corpusCutoff, requestedLimit: 20, returnedCount: 0, examinedCount: 0, acceptedCount: 0, duplicateCount: 0, futureExcludedCount: 0, failedFetchCount: 2, timestamp: '2026-09-29T00:00:00Z', status: 'FAILED', diagnostics: ['OpenAlex HTTP 429'] })
  const noResults = makeCoverage({ queryId: 'query_empty', provider: 'openalex', query: query.query, filters: {}, corpusCutoff: query.corpusCutoff, requestedLimit: 20, returnedCount: 0, examinedCount: 0, acceptedCount: 0, duplicateCount: 0, futureExcludedCount: 0, failedFetchCount: 0, timestamp: '2026-09-29T00:00:01Z', status: 'NO_RESULTS', diagnostics: [] })
  const failedMembership = makeLiteratureQueryMembership(query, failed, [])
  assert.deepEqual(selectSourcesForMembership(query, failedMembership, new Map([[record.literatureId, record]]), 5), [])
  assert.throws(() => validateLiteratureQueryMembership({ ...failedMembership, literatureIds: [record.literatureId] }, query, failed, new Map([[record.literatureId, record]])), /failed or empty search coverage/i)
  assert.equal(noResults.status, 'NO_RESULTS'); assert.notEqual(noResults.status, failed.status)
})

test('PARTIAL membership selects accepted records and preserves partial coverage', () => {
  const cutoff = '2026-09-29'
  const query = { queryId: 'query_partial', needId: 'need_partial', query: 'topic', provider: 'openalex', filters: {}, corpusCutoff: cutoff, reason: 'test', attempt: 1 }
  const record = normalizeLiterature({ title: 'Accepted topic', authors: [], publicationDate: '2024-01-01', abstract: 'topic', openAlexId: 'https://openalex.org/Wpartial', provider: 'openalex', providerId: 'https://openalex.org/Wpartial', retrievedAt: '2026-09-29T00:00:00Z' })
  const coverage = makeCoverage({ queryId: query.queryId, provider: 'openalex', query: query.query, filters: {}, corpusCutoff: cutoff, requestedLimit: 20, returnedCount: 1, examinedCount: 2, acceptedCount: 1, duplicateCount: 0, futureExcludedCount: 1, failedFetchCount: 0, timestamp: '2026-09-29T00:00:00Z', status: 'PARTIAL', diagnostics: ['one page incomplete'] })
  const membership = makeLiteratureQueryMembership(query, coverage, [record]); const recordsById = new Map([[record.literatureId, record]])
  validateLiteratureQueryMembership(membership, query, coverage, recordsById)
  assert.equal(membership.status, 'PARTIAL')
  assert.deepEqual(selectSourcesForMembership(query, membership, recordsById, 5).map(item => item.literatureId), [record.literatureId])
})

test('source-selection provenance rejects foreign query membership', () => {
  const cutoff = '2026-09-29'; const record = normalizeLiterature({ title: 'Alpha', authors: [], publicationDate: '2024-01-01', abstract: 'alpha', doi: '10.1000/alpha2', openAlexId: 'https://openalex.org/Walpha2', provider: 'openalex', providerId: 'https://openalex.org/Walpha2', retrievedAt: cutoff })
  const query = { queryId: 'query_a', needId: 'need_a', query: 'alpha', provider: 'openalex', filters: {}, corpusCutoff: cutoff, reason: 'test', attempt: 1 }; const need = { needId: 'need_a', originNodeIds: ['node_a'], goal: 'alpha', concepts: ['alpha'], constraints: [], priority: 1, reason: 'test', corpusCutoff: cutoff }; const coverage = makeCoverage({ queryId: query.queryId, provider: 'openalex', query: query.query, filters: {}, corpusCutoff: cutoff, requestedLimit: 20, returnedCount: 1, examinedCount: 1, acceptedCount: 1, duplicateCount: 0, futureExcludedCount: 0, failedFetchCount: 0, timestamp: '2026-09-29T00:00:00Z', status: 'COMPLETE', diagnostics: [] }); const membership = makeLiteratureQueryMembership(query, coverage, [record]); const recordsById = new Map([[record.literatureId, record]])
  const selection = { originProblemNodeIds: ['node_a'], retrievalNeedId: need.needId, queryId: query.queryId, searchCoverageId: coverage.coverageId, searchCoverageStatus: coverage.status, records: [record] }
  assert.doesNotThrow(() => validateSourceSelection(selection, query, need, coverage, membership, recordsById))
  assert.deepEqual({ originProblemNodeIds: selection.originProblemNodeIds, retrievalNeedId: selection.retrievalNeedId, queryId: selection.queryId, searchCoverageId: selection.searchCoverageId, searchCoverageStatus: selection.searchCoverageStatus, literatureId: selection.records[0].literatureId }, { originProblemNodeIds: ['node_a'], retrievalNeedId: 'need_a', queryId: 'query_a', searchCoverageId: coverage.coverageId, searchCoverageStatus: 'COMPLETE', literatureId: record.literatureId })
  assert.throws(() => validateSourceSelection(selection, { ...query, queryId: 'query_b' }, need, coverage, membership, recordsById), /does not match query/i)
})

test('SOURCE_SELECT normalization preserves scientific tokens and exposes its decomposition', () => {
  const queryText = 'DDIM / ODE public-key performance-losslessness Gaussian Shading latent-space ECDSA mark and the for with from based gaussian'
  const normalized = normalizeQueryTerms(queryText)
  assert.deepEqual(normalized.tokens, ['ddim', 'ode', 'public', 'key', 'performance', 'losslessness', 'gaussian', 'shading', 'latent', 'space', 'ecdsa', 'mark'])
  assert.deepEqual(normalized.removedStopwords, ['and', 'the', 'for', 'with', 'from', 'based'])

  const record = normalizeLiterature({ title: 'DDIM/ODE public-key performance-losslessness Gaussian-Shading latent-space ECDSA Mark', authors: [], publicationDate: '2024-01-01', abstract: '', doi: '10.1000/scoring', provider: 'openalex', providerId: 'Wscoring', retrievedAt: '2026-09-29T00:00:00Z' })
  const query = { queryId: 'query_scoring', needId: 'need_scoring', query: queryText, provider: 'openalex', filters: {}, corpusCutoff: '2026-09-29', reason: 'test', attempt: 1 }
  const score = scoreLiteratureCandidate(record, query)
  assert.deepEqual(score.matchedTokens, normalized.tokens)
  assert.deepEqual(score.titleMatches, normalized.tokens)
  assert.deepEqual(score.abstractMatches, [])
  assert.equal(score.lexicalScore, 120)
  assert.equal(score.identifierBonus, 3)
  assert.equal(score.dateBonus, 1)
  assert.equal(score.totalScore, 124)
})

test('SOURCE_SELECT uses token boundaries and deduplicates query tokens', () => {
  assert.deepEqual(normalizeQueryTerms('Gaussian gaussian Gaussian and and').tokens, ['gaussian'])
  assert.deepEqual(normalizeQueryTerms('Gaussian gaussian Gaussian and and').removedStopwords, ['and'])
  const query = { queryId: 'query_boundary', needId: 'need_boundary', query: 'mark', provider: 'openalex', filters: {}, corpusCutoff: '2026-09-29', reason: 'test', attempt: 1 }
  const watermark = normalizeLiterature({ title: 'Watermarking systems', authors: [], publicationDate: '2024-01-01', abstract: '', doi: '10.1000/watermarking', provider: 'openalex', providerId: 'Wwatermarking', retrievedAt: '2026-09-29T00:00:00Z' })
  const mark = normalizeLiterature({ title: 'Mark systems', authors: [], publicationDate: '2024-01-01', abstract: '', doi: '10.1000/mark', provider: 'openalex', providerId: 'Wmark', retrievedAt: '2026-09-29T00:00:00Z' })
  assert.equal(scoreLiteratureCandidate(watermark, query).lexicalScore, 0)
  assert.deepEqual(scoreLiteratureCandidate(mark, query).matchedTokens, ['mark'])
  assert.equal(scoreLiteratureCandidate(mark, query).lexicalScore, 10)
})

test('SOURCE_SELECT preserves identifier/date bonuses, deterministic ties, top-k, and low-information behavior', () => {
  const baseQuery = { queryId: 'query_ties', needId: 'need_ties', query: 'operator verification performance', provider: 'openalex', filters: {}, corpusCutoff: '2026-09-29', reason: 'test', attempt: 1 }
  const makeRecord = (literatureId, identifiers = {}) => normalizeLiterature({ title: 'Thermal storage operator verification performance', authors: [], publicationDate: '2024-01-01', abstract: '', ...identifiers, provider: 'openalex', providerId: literatureId, retrievedAt: '2026-09-29T00:00:00Z' })
  const doi = makeRecord('Wdoi', { doi: '10.1000/doi' })
  const openAlex = makeRecord('Wopenalex', { openAlexId: 'https://openalex.org/Wopenalex' })
  const bare = makeRecord('Wbare')
  const doiScore = scoreLiteratureCandidate(doi, baseQuery)
  const openAlexScore = scoreLiteratureCandidate(openAlex, baseQuery)
  const bareScore = scoreLiteratureCandidate(bare, baseQuery)
  assert.equal(doiScore.identifierBonus - openAlexScore.identifierBonus, 1)
  assert.equal(openAlexScore.identifierBonus - bareScore.identifierBonus, 2)
  const urlOnly = makeRecord('Wurl', { urls: ['https://example.test/paper'] })
  assert.equal(scoreLiteratureCandidate(urlOnly, baseQuery).identifierBonus, 1)
  assert.equal(doiScore.dateBonus, 1)
  assert.equal(doiScore.lexicalScore, openAlexScore.lexicalScore)

  const tied = ['lit_c', 'lit_a', 'lit_b'].map(id => makeRecord(id, { doi: `10.1000/${id}` }))
  assert.deepEqual(selectSources(tied, { ...baseQuery, queryId: 'query_tied', query: 'operator' }, 2).map(record => record.literatureId), [...tied].sort((a, b) => a.literatureId.localeCompare(b.literatureId)).slice(0, 2).map(record => record.literatureId))
  assert.equal(selectSources(tied, { ...baseQuery, queryId: 'query_tied', query: 'operator' }, 2).length, 2)
  assert.equal(selectSources([bare], { ...baseQuery, queryId: 'query_low_info', query: 'xylophone' }, 5).length, 1)
})

test('offline SOURCE_SELECT regression fixture stays separate from scientific evidence', () => {
  const fixture = JSON.parse(readFileSync('evaluation/relevance/source-select-regression.json', 'utf8'))
  assert.equal(fixture.fixtureType, 'offline_source_select_relevance_benchmark')
  assert.equal(fixture.scientificEvidence, false)
  assert.equal(fixture.annotationsAreRankingDiagnostics, true)
  assert.equal(fixture.cases.length, 7)
  assert.equal(new Set(fixture.cases.map(item => item.caseId)).size, fixture.cases.length)
  assert.ok(fixture.cases.some(item => item.caseId === 'clearly-relevant-gaussian-shading'))
  assert.ok(fixture.cases.some(item => item.caseId === 'legitimate-shared-latent-watermark'))
})

test('EvidenceGraph preserves support, contradiction, conflict, and stable ordering', () => {
  const graph = new EvidenceGraph()
  graph.addClaim({ claimId: 'claim_1', statement: 'Method helps', claimType: 'result', scope: 'dataset', uncertainty: 0.2 })
  const base = { kind: 'abstract', claim: 'Method helps', polarity: 'SUPPORT', provenance: { sourceType: 'url', sourceId: 'source', locator: 'abstract', contentHash: 'a'.repeat(64) }, claimIds: [], limitations: [], confidence: 0.8, createdAt: '2026-09-28T00:00:00Z', literatureId: 'lit_1', modelInterpretation: false }
  graph.addEvidence({ ...base, evidenceId: 'e2', evidenceLevel: 'ABSTRACT_EVIDENCE' })
  graph.addEvidence({ ...base, evidenceId: 'e1', polarity: 'CONTRADICT', evidenceLevel: 'ABSTRACT_EVIDENCE', literatureId: 'lit_2' })
  graph.linkEvidenceToClaim({ evidenceId: 'e2', claimId: 'claim_1', relation: 'SUPPORTS' })
  graph.linkEvidenceToClaim({ evidenceId: 'e1', claimId: 'claim_1', relation: 'CONTRADICTS' })
  assert.deepEqual(graph.getEvidenceForClaim('claim_1').map(item => item.evidenceId), ['e1', 'e2'])
  assert.equal(graph.getConflictedClaims().length, 1)
})
