import { contentHash, deterministicId } from '../domain/ids.ts'
import type { EvidenceId, GraphNodeId, ClaimId } from '../domain/ids.ts'
import type { CoverageStatus, Evidence, ResearchProblemGraph, ResearchGraphNode } from '../domain/types.ts'
import { ValidationError } from '../domain/validation.ts'
import { scoreLiteratureCandidate } from './source-scoring.ts'

export type { CoverageStatus } from '../domain/types.ts'

export interface LiteratureRecord {
  readonly literatureId: string
  readonly title: string
  readonly authors: readonly string[]
  readonly year?: number
  readonly publicationDate?: string
  readonly publicationDateStatus?: PublicationDateStatus
  readonly venue?: string
  readonly abstract?: string
  readonly doi?: string
  readonly openAlexId?: string
  readonly arxivId?: string
  readonly urls: readonly string[]
  readonly providerRecords: Readonly<Record<string, string>>
  readonly retrievedAt: string
}
export type PublicationDateStatus = 'KNOWN' | 'MISSING' | 'MALFORMED'
export const UNKNOWN_DATE_POLICY = 'EXCLUDE_FROM_CUTOFF_CORPUS' as const
export const OPENALEX_DEFAULT_TIMEOUT_MS = 10000
export const OPENALEX_MAX_ATTEMPTS = 2
export const OPENALEX_RETRY_POLICY = 'RETRY_ONCE_AFTER_50MS' as const

export function validateCorpusCutoff(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ValidationError('corpusCutoff must be an ISO calendar date (YYYY-MM-DD)', '$.corpusCutoff', 'INVALID_CORPUS_CUTOFF')
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new ValidationError('corpusCutoff must be a real calendar date', '$.corpusCutoff', 'INVALID_CORPUS_CUTOFF')
  return value
}

export function requireCorpusCutoff(value: unknown): string {
  if (value === undefined || value === null || value === '') throw new ValidationError('explicit corpusCutoff is required before LITERATURE_SEARCH', '$.corpusCutoff', 'CORPUS_CUTOFF_REQUIRED')
  return validateCorpusCutoff(value)
}

function parsePublicationDate(value: unknown): { readonly date?: string; readonly status: PublicationDateStatus } {
  if (value === undefined || value === null || value === '') return { status: 'MISSING' }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { status: 'MALFORMED' }
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return { status: 'MALFORMED' }
  return { date: value, status: 'KNOWN' }
}

export interface AliasCandidate { readonly leftLiteratureId: string; readonly rightLiteratureId: string; readonly reason: string }
export function normalizeDoi(value: string): string { return value.trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').replace(/^doi:\s*/, '').replace(/[)\].,;]+$/, '') }
export function normalizeLiterature(raw: { title?: unknown; authors?: unknown; year?: unknown; publicationDate?: unknown; venue?: unknown; abstract?: unknown; doi?: unknown; openAlexId?: unknown; arxivId?: unknown; urls?: unknown; provider?: string; providerId?: string; retrievedAt: string }): LiteratureRecord {
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''; if (!title) throw new ValidationError('literature title is required', '$.title')
  const doi = typeof raw.doi === 'string' && raw.doi.trim() ? normalizeDoi(raw.doi) : undefined; const openAlexId = typeof raw.openAlexId === 'string' && raw.openAlexId.trim() ? raw.openAlexId.trim() : undefined; const arxivId = typeof raw.arxivId === 'string' && raw.arxivId.trim() ? raw.arxivId.trim() : undefined
  const identity = doi ? `doi:${doi}` : openAlexId ? `openalex:${openAlexId}` : arxivId ? `arxiv:${arxivId}` : (Array.isArray(raw.urls) && raw.urls[0]) ? `url:${String(raw.urls[0]).trim()}` : `title:${title.toLowerCase()}`
  const publication = parsePublicationDate(raw.publicationDate)
  return { literatureId: deterministicId('literature', identity), title, authors: Array.isArray(raw.authors) ? raw.authors.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean) : [], year: typeof raw.year === 'number' && Number.isInteger(raw.year) ? raw.year : undefined, publicationDate: publication.date, publicationDateStatus: publication.status, venue: typeof raw.venue === 'string' ? raw.venue : undefined, abstract: typeof raw.abstract === 'string' ? raw.abstract : undefined, doi, openAlexId, arxivId, urls: Array.isArray(raw.urls) ? raw.urls.filter(item => typeof item === 'string').map(String) : [], providerRecords: raw.provider && raw.providerId ? { [raw.provider]: raw.providerId } : {}, retrievedAt: raw.retrievedAt }
}
export function aliasCandidate(left: LiteratureRecord, right: LiteratureRecord): AliasCandidate | undefined { if (left.literatureId === right.literatureId) return undefined; if (left.title.toLowerCase() === right.title.toLowerCase()) return { leftLiteratureId: left.literatureId, rightLiteratureId: right.literatureId, reason: 'same title without deterministic shared identifier' }; return undefined }

export interface RetrievalNeed { readonly needId: string; readonly originNodeIds: readonly GraphNodeId[]; readonly goal: string; readonly concepts: readonly string[]; readonly constraints: readonly string[]; readonly priority: number; readonly reason: string; readonly corpusCutoff?: string }
export function deriveRetrievalNeeds(graph: ResearchProblemGraph, corpusCutoff?: string): RetrievalNeed[] { const eligible: ResearchGraphNode[] = graph.nodes.filter(node => ['open-question', 'limitation', 'assumption', 'method', 'failure-case', 'claim'].includes(node.type)); return eligible.map(node => ({ needId: deterministicId('retrieval_need', node.nodeId), originNodeIds: [node.nodeId], goal: node.label, concepts: node.label.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 2), constraints: [], priority: node.type === 'open-question' || node.type === 'failure-case' ? 1 : 2, reason: `derived from ${node.type} node`, corpusCutoff })).sort((a, b) => a.needId.localeCompare(b.needId)) }

export interface LiteratureQuery { readonly queryId: string; readonly needId: string; readonly query: string; readonly provider: string; readonly filters: Readonly<Record<string, string | number>>; readonly corpusCutoff?: string; readonly reason: string; readonly attempt: number }
export interface QueryPlanner { plan(needs: readonly RetrievalNeed[], limit?: number): readonly LiteratureQuery[] }
export function planQueries(needs: readonly RetrievalNeed[], provider = 'openalex', limit = 20): LiteratureQuery[] { const output: LiteratureQuery[] = []; const seen = new Set<string>(); for (const need of needs) { if (output.length >= limit) break; const query = need.concepts.join(' ').trim() || need.goal; const key = `${provider}|${query.toLowerCase()}|${need.corpusCutoff ?? ''}`; if (seen.has(key)) continue; seen.add(key); output.push({ queryId: deterministicId('query', key), needId: need.needId, query, provider, filters: {}, corpusCutoff: need.corpusCutoff, reason: need.reason, attempt: 1 }) } return output }
export function selectSources(records: readonly LiteratureRecord[], query: LiteratureQuery, limit = 5): LiteratureRecord[] {
  const candidates = records.filter(record => !query.corpusCutoff || (record.publicationDateStatus === 'KNOWN' && record.publicationDate !== undefined && record.publicationDate <= query.corpusCutoff))
  return candidates.map(record => ({ record, score: scoreLiteratureCandidate(record, query).totalScore }))
    .sort((a, b) => b.score - a.score || a.record.literatureId.localeCompare(b.record.literatureId))
    .slice(0, Math.max(0, limit)).map(candidate => candidate.record)
}

export interface SearchCoverage { readonly coverageId: string; readonly queryId: string; readonly provider: string; readonly query: string; readonly filters: Readonly<Record<string, string | number>>; readonly corpusCutoff?: string; readonly requestedLimit: number; readonly returnedCount: number; readonly examinedCount: number; readonly acceptedCount: number; readonly duplicateCount: number; readonly futureExcludedCount: number; readonly unknownDateCount: number; readonly unknownDatePolicy: typeof UNKNOWN_DATE_POLICY; readonly failedFetchCount: number; readonly timeoutMs: number; readonly maxAttempts: number; readonly retryPolicy: typeof OPENALEX_RETRY_POLICY; readonly timestamp: string; readonly status: CoverageStatus; readonly diagnostics: readonly string[] }
type SearchCoverageInput = Omit<SearchCoverage, 'coverageId' | 'unknownDateCount' | 'unknownDatePolicy' | 'timeoutMs' | 'maxAttempts' | 'retryPolicy'> & Partial<Pick<SearchCoverage, 'unknownDateCount' | 'unknownDatePolicy' | 'timeoutMs' | 'maxAttempts' | 'retryPolicy'>>
export function makeCoverage(input: SearchCoverageInput): SearchCoverage { return { ...input, unknownDateCount: input.unknownDateCount ?? 0, unknownDatePolicy: input.unknownDatePolicy ?? UNKNOWN_DATE_POLICY, timeoutMs: input.timeoutMs ?? OPENALEX_DEFAULT_TIMEOUT_MS, maxAttempts: input.maxAttempts ?? OPENALEX_MAX_ATTEMPTS, retryPolicy: input.retryPolicy ?? OPENALEX_RETRY_POLICY, coverageId: deterministicId('coverage', { queryId: input.queryId, provider: input.provider, timestamp: input.timestamp }) } }

export interface LiteratureQueryMembership {
  readonly queryId: string
  readonly retrievalNeedId: string
  readonly coverageId: string
  readonly status: CoverageStatus
  readonly literatureIds: readonly string[]
}

export interface SourceSelection {
  readonly originProblemNodeIds: readonly GraphNodeId[]
  readonly retrievalNeedId: string
  readonly queryId: string
  readonly searchCoverageId: string
  readonly searchCoverageStatus: CoverageStatus
  readonly records: readonly LiteratureRecord[]
}

export function makeLiteratureQueryMembership(query: LiteratureQuery, coverage: SearchCoverage, records: readonly LiteratureRecord[]): LiteratureQueryMembership {
  if (coverage.queryId !== query.queryId) throw new ValidationError('coverage does not belong to query', '$.coverage.queryId', 'INVALID_PROVENANCE')
  const literatureIds = [...new Set(records.map(record => record.literatureId))]
  return { queryId: query.queryId, retrievalNeedId: query.needId, coverageId: coverage.coverageId, status: coverage.status, literatureIds }
}

export function validateLiteratureQueryMembership(membership: LiteratureQueryMembership, query: LiteratureQuery, coverage: SearchCoverage, recordsById: ReadonlyMap<string, LiteratureRecord>): LiteratureQueryMembership {
  if (membership.queryId !== query.queryId || membership.retrievalNeedId !== query.needId) throw new ValidationError('query membership does not match query', '$.membership', 'INVALID_PROVENANCE')
  if (membership.coverageId !== coverage.coverageId || membership.status !== coverage.status || coverage.queryId !== query.queryId) throw new ValidationError('query membership does not match search coverage', '$.membership', 'INVALID_PROVENANCE')
  const seen = new Set<string>()
  for (const literatureId of membership.literatureIds) {
    if (!literatureId || seen.has(literatureId)) throw new ValidationError('query membership contains duplicate or empty literature ID', '$.membership.literatureIds', 'INVALID_PROVENANCE')
    seen.add(literatureId)
    const record = recordsById.get(literatureId)
    if (!record) throw new ValidationError(`query membership references unknown literature ${literatureId}`, '$.membership.literatureIds', 'INVALID_PROVENANCE')
    if (query.corpusCutoff && (record.publicationDateStatus !== 'KNOWN' || !record.publicationDate || record.publicationDate > query.corpusCutoff)) throw new ValidationError('query membership contains a record outside the trusted corpus cutoff', '$.membership.literatureIds', 'INVALID_CORPUS_CUTOFF')
  }
  if ((membership.status === 'FAILED' || membership.status === 'NO_RESULTS') && membership.literatureIds.length > 0) throw new ValidationError('failed or empty search coverage cannot have accepted literature membership', '$.membership.literatureIds', 'INVALID_PROVENANCE')
  return membership
}

export function selectSourcesForMembership(query: LiteratureQuery, membership: LiteratureQueryMembership, recordsById: ReadonlyMap<string, LiteratureRecord>, limit = 5): LiteratureRecord[] {
  if (membership.status === 'FAILED' || membership.status === 'NO_RESULTS') return []
  const records = membership.literatureIds.map(literatureId => recordsById.get(literatureId)).filter((record): record is LiteratureRecord => record !== undefined)
  return selectSources(records, query, limit)
}

export function validateSourceSelection(selection: SourceSelection, query: LiteratureQuery, need: RetrievalNeed, coverage: SearchCoverage, membership: LiteratureQueryMembership, recordsById: ReadonlyMap<string, LiteratureRecord>): SourceSelection {
  if (selection.queryId !== query.queryId || selection.retrievalNeedId !== need.needId || query.needId !== need.needId) throw new ValidationError('source selection does not match query and retrieval need', '$.sourceSelection', 'INVALID_PROVENANCE')
  if (coverage.queryId !== query.queryId || membership.queryId !== query.queryId || membership.retrievalNeedId !== need.needId || selection.searchCoverageId !== coverage.coverageId || selection.searchCoverageStatus !== coverage.status || membership.coverageId !== coverage.coverageId) throw new ValidationError('source selection does not match search coverage', '$.sourceSelection', 'INVALID_PROVENANCE')
  if (!selection.originProblemNodeIds.length || selection.originProblemNodeIds.length !== need.originNodeIds.length || selection.originProblemNodeIds.some(nodeId => !need.originNodeIds.includes(nodeId))) throw new ValidationError('source selection origin nodes do not match retrieval need', '$.sourceSelection.originProblemNodeIds', 'INVALID_PROVENANCE')
  const allowed = new Set(membership.literatureIds)
  const seen = new Set<string>()
  for (const record of selection.records) {
    if (seen.has(record.literatureId)) throw new ValidationError('source selection contains a duplicate literature path', '$.sourceSelection.records', 'DUPLICATE_ID')
    seen.add(record.literatureId)
    if (!allowed.has(record.literatureId) || !recordsById.has(record.literatureId)) throw new ValidationError('source selection contains literature not accepted for its query', '$.sourceSelection.records', 'INVALID_PROVENANCE')
    const canonical = recordsById.get(record.literatureId)!
    if (canonical.publicationDateStatus !== 'KNOWN' || !canonical.publicationDate || (query.corpusCutoff && canonical.publicationDate > query.corpusCutoff)) throw new ValidationError('source selection contains literature outside the trusted cutoff', '$.sourceSelection.records', 'INVALID_CORPUS_CUTOFF')
  }
  if ((coverage.status === 'FAILED' || coverage.status === 'NO_RESULTS') && selection.records.length > 0) throw new ValidationError('failed or empty search coverage cannot select literature', '$.sourceSelection.records', 'INVALID_PROVENANCE')
  return selection
}

export interface AcademicSearchProvider { readonly id: string; search(query: LiteratureQuery, options?: { readonly limit?: number; readonly timeoutMs?: number }): Promise<{ records: readonly LiteratureRecord[]; coverage: SearchCoverage; excludedFuture: readonly LiteratureRecord[] }> ; resolve(identifier: string): Promise<LiteratureRecord | undefined>; fetchMetadata(identifier: string): Promise<LiteratureRecord | undefined> }
export class OpenAlexProvider implements AcademicSearchProvider {
  readonly id = 'openalex'; private readonly fetchImpl: typeof fetch; private readonly mailto?: string; constructor(fetchImpl: typeof fetch = fetch, mailto?: string) { this.fetchImpl = fetchImpl; this.mailto = mailto }
  async search(query: LiteratureQuery, options: { readonly limit?: number; readonly timeoutMs?: number } = {}) { const cutoff = requireCorpusCutoff(query.corpusCutoff); const limit = Math.min(options.limit ?? 10, 50); const timeoutMs = options.timeoutMs ?? OPENALEX_DEFAULT_TIMEOUT_MS; const suppliedFilter = typeof query.filters.filter === 'string' ? query.filters.filter : undefined; const providerFilter = suppliedFilter ? `${suppliedFilter},to_publication_date:${cutoff}` : `to_publication_date:${cutoff}`; const coverageFilters = { ...query.filters, filter: providerFilter }; const url = new URL('https://api.openalex.org/works'); url.searchParams.set('search', query.query); url.searchParams.set('per-page', String(limit)); url.searchParams.set('filter', providerFilter); if (this.mailto) url.searchParams.set('mailto', this.mailto); const started = new Date().toISOString(); try { const response = await this.request(url, timeoutMs); const body = await response.json() as { results?: unknown[] }; const all = Array.isArray(body.results) ? body.results : []; const records = all.map(item => this.normalize(item, started)); const futureExcluded = records.filter(item => item.publicationDateStatus === 'KNOWN' && item.publicationDate !== undefined && item.publicationDate > cutoff); const unknownDates = records.filter(item => item.publicationDateStatus !== 'KNOWN' || item.publicationDate === undefined); const accepted = records.filter(item => item.publicationDateStatus === 'KNOWN' && item.publicationDate !== undefined && item.publicationDate <= cutoff); return { records: accepted, excludedFuture: futureExcluded, coverage: makeCoverage({ queryId: query.queryId, provider: this.id, query: query.query, filters: coverageFilters, corpusCutoff: cutoff, requestedLimit: limit, returnedCount: records.length, examinedCount: records.length, acceptedCount: accepted.length, duplicateCount: 0, futureExcludedCount: futureExcluded.length, unknownDateCount: unknownDates.length, unknownDatePolicy: UNKNOWN_DATE_POLICY, failedFetchCount: 0, timeoutMs, maxAttempts: OPENALEX_MAX_ATTEMPTS, retryPolicy: OPENALEX_RETRY_POLICY, timestamp: started, status: records.length ? 'COMPLETE' : 'NO_RESULTS', diagnostics: [] }) } } catch (error) { return { records: [], excludedFuture: [], coverage: makeCoverage({ queryId: query.queryId, provider: this.id, query: query.query, filters: coverageFilters, corpusCutoff: cutoff, requestedLimit: limit, returnedCount: 0, examinedCount: 0, acceptedCount: 0, duplicateCount: 0, futureExcludedCount: 0, unknownDateCount: 0, unknownDatePolicy: UNKNOWN_DATE_POLICY, failedFetchCount: 0, timeoutMs, maxAttempts: OPENALEX_MAX_ATTEMPTS, retryPolicy: OPENALEX_RETRY_POLICY, timestamp: started, status: 'FAILED', diagnostics: [error instanceof Error ? error.message : 'provider failure'] }) } } }
  async resolve(identifier: string) { return this.fetchMetadata(identifier) }
  async fetchMetadata(identifier: string) { const response = await this.request(new URL(`https://api.openalex.org/works/${encodeURIComponent(identifier)}`), 10000); return this.normalize(await response.json(), new Date().toISOString()) }
  private async request(url: URL, timeoutMs: number): Promise<Response> { let last: unknown; for (let attempt = 0; attempt < OPENALEX_MAX_ATTEMPTS; attempt++) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs); try { const response = await this.fetchImpl(url, { signal: controller.signal, headers: { 'User-Agent': 'EvoResearch/0.1 (academic retrieval)' } }); if (response.status === 429 || response.status >= 500) throw new Error(`OpenAlex HTTP ${response.status}`); if (!response.ok) throw new Error(`OpenAlex HTTP ${response.status}`); return response } catch (error) { last = error; if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 50)) } finally { clearTimeout(timer) } } throw last instanceof Error ? last : new Error('OpenAlex request failed') }
  private normalize(item: unknown, retrievedAt: string): LiteratureRecord { const value = item as Record<string, unknown>; const primary = (value.primary_location ?? {}) as Record<string, unknown>; const source = (primary.source ?? {}) as Record<string, unknown>; const ids = (value.ids ?? {}) as Record<string, unknown>; const authors = Array.isArray(value.authorships) ? value.authorships.map(author => ((author as Record<string, unknown>).author as Record<string, unknown>)?.display_name).filter((name): name is string => typeof name === 'string') : []; const inverted = value.abstract_inverted_index as Record<string, unknown> | undefined; const abstract = inverted && typeof inverted === 'object' ? Object.entries(inverted).flatMap(([word, positions]) => Array.isArray(positions) ? positions.map(position => ({ word, position: Number(position) })) : []).sort((a, b) => a.position - b.position).map(entry => entry.word).join(' ') : undefined; return normalizeLiterature({ title: value.title, authors, year: value.publication_year, publicationDate: value.publication_date, venue: source.display_name, abstract, doi: value.doi, openAlexId: value.id, urls: [typeof value.id === 'string' ? value.id : '', typeof primary.landing_page_url === 'string' ? primary.landing_page_url : ''].filter(Boolean), provider: this.id, providerId: typeof ids.openalex === 'string' ? ids.openalex : typeof value.id === 'string' ? value.id : undefined, retrievedAt }) }
}

export type EvidenceLevel = 'SOURCE_METADATA' | 'ABSTRACT_EVIDENCE' | 'FULL_TEXT_EVIDENCE' | 'MODEL_INTERPRETATION'
export interface LiteratureEvidence extends Evidence { readonly literatureId: string; readonly evidenceLevel: EvidenceLevel; readonly modelInterpretation: boolean }
export function validateLiteratureEvidence(value: LiteratureEvidence): LiteratureEvidence { if (value.evidenceLevel === 'ABSTRACT_EVIDENCE' && value.provenance.locator?.toLowerCase().includes('full-text')) throw new ValidationError('abstract evidence cannot be marked full-text', '$.evidenceLevel', 'INVALID_EVIDENCE_LEVEL'); if (value.evidenceLevel === 'MODEL_INTERPRETATION' && !value.modelInterpretation) throw new ValidationError('model interpretation must be explicitly marked', '$.modelInterpretation', 'INVALID_EVIDENCE_LEVEL'); return value }
export type ClaimRelation = 'SUPPORTS' | 'CONTRADICTS' | 'QUALIFIES' | 'INSUFFICIENT' | 'MOTIVATES'
export interface LiteratureClaim { readonly claimId: ClaimId; readonly statement: string; readonly claimType: string; readonly scope: string; readonly uncertainty: number }
export interface ClaimEvidenceLink { readonly evidenceId: EvidenceId; readonly claimId: ClaimId; readonly relation: ClaimRelation }
export class EvidenceGraph {
  private readonly claims = new Map<string, LiteratureClaim>(); private readonly evidence = new Map<string, LiteratureEvidence>(); private readonly links: ClaimEvidenceLink[] = []
  addClaim(claim: LiteratureClaim) { if (this.claims.has(claim.claimId)) throw new ValidationError('duplicate claim', '$.claimId', 'DUPLICATE_ID'); this.claims.set(claim.claimId, claim) }
  addEvidence(item: LiteratureEvidence) { validateLiteratureEvidence(item); if (this.evidence.has(item.evidenceId)) throw new ValidationError('duplicate evidence', '$.evidenceId', 'DUPLICATE_ID'); this.evidence.set(item.evidenceId, item) }
  linkEvidenceToClaim(link: ClaimEvidenceLink) { const item = this.evidence.get(link.evidenceId); const claim = this.claims.get(link.claimId); if (!item || !claim) throw new ValidationError('link references unknown record', '$', 'INVALID_PROVENANCE'); if (item.evidenceLevel === 'SOURCE_METADATA' && claim.claimType !== 'metadata') throw new ValidationError('metadata-only evidence cannot support a scientific claim', '$', 'INVALID_EVIDENCE_LEVEL'); this.links.push(link) }
  getEvidenceForClaim(id: ClaimId) { return this.links.filter(link => link.claimId === id).map(link => this.evidence.get(link.evidenceId)!).sort((a, b) => a.evidenceId.localeCompare(b.evidenceId)) }
  getSupportingEvidence(id: ClaimId) { return this.byRelation(id, 'SUPPORTS') }
  getContradictingEvidence(id: ClaimId) { return this.byRelation(id, 'CONTRADICTS') }
  getQualifyingEvidence(id: ClaimId) { return this.byRelation(id, 'QUALIFIES') }
  getClaimsForSource(sourceId: string) { const ids = this.links.filter(link => this.evidence.get(link.evidenceId)?.literatureId === sourceId).map(link => link.claimId); return [...new Set(ids)].map(id => this.claims.get(id)!).sort((a, b) => a.claimId.localeCompare(b.claimId)) }
  getSourcesForClaim(id: ClaimId) { return [...new Set(this.getEvidenceForClaim(id).map(item => item.literatureId))].sort() }
  getConflictedClaims() { return [...this.claims.values()].filter(claim => this.getSupportingEvidence(claim.claimId).length > 0 && this.getContradictingEvidence(claim.claimId).length > 0).sort((a, b) => a.claimId.localeCompare(b.claimId)) }
  getEvidenceByLevel(level: EvidenceLevel) { return [...this.evidence.values()].filter(item => item.evidenceLevel === level).sort((a, b) => a.evidenceId.localeCompare(b.evidenceId)) }
  private byRelation(id: ClaimId, relation: ClaimRelation) { return this.links.filter(link => link.claimId === id && link.relation === relation).map(link => this.evidence.get(link.evidenceId)!).sort((a, b) => a.evidenceId.localeCompare(b.evidenceId)) }
}
