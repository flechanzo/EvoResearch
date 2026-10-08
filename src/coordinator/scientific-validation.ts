import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ArtifactManifest, ExtractedDocument } from '../domain/extraction.ts'
import { assessExtraction, requireExtractionPass, type ExtractionQuality } from '../evaluation/harness.ts'
import { boundDocumentContext } from './context.ts'
import type { ModelAttemptRecord, ResponsesModelGateway } from '../adapters/responses-model.ts'

export const VALIDATION_STAGES = ['INGEST', 'EXTRACT', 'PAPER_READ', 'PROBLEM_EXTRACT', 'PROBLEM_GRAPH', 'RETRIEVAL_NEEDS', 'QUERY_PLAN', 'LITERATURE_SEARCH', 'SOURCE_SELECT', 'EVIDENCE_EXTRACT', 'EVIDENCE_GRAPH', 'EVALUATE', 'REPORT'] as const
export type ValidationStage = typeof VALIDATION_STAGES[number]
export interface ScientificValidationConfig { readonly outputRoot: string; readonly caseId: string; readonly modelRoute?: unknown; readonly modelIdentifier?: string; readonly skillVersions: readonly string[]; readonly provider?: string; readonly corpusCutoff?: string; readonly maxContextCharacters?: number; readonly extractionOverride?: boolean }
export interface StageRecord { readonly stage: ValidationStage; readonly status: 'SUCCEEDED' | 'FAILED'; readonly startedAt: string; readonly completedAt: string; readonly artifactPaths: readonly string[]; readonly error?: string }
export interface ValidationRunResult { readonly runId: string; readonly outputDirectory: string; readonly stages: readonly StageRecord[]; readonly failedStage?: ValidationStage }
export interface ValidationStageHandlers { readonly INGEST?: () => Promise<unknown>; readonly EXTRACT?: () => Promise<unknown>; readonly PAPER_READ?: () => Promise<unknown>; readonly PROBLEM_EXTRACT?: () => Promise<unknown>; readonly PROBLEM_GRAPH?: () => Promise<unknown>; readonly RETRIEVAL_NEEDS?: () => Promise<unknown>; readonly QUERY_PLAN?: () => Promise<unknown>; readonly LITERATURE_SEARCH?: () => Promise<unknown>; readonly SOURCE_SELECT?: () => Promise<unknown>; readonly EVIDENCE_EXTRACT?: () => Promise<unknown>; readonly EVIDENCE_GRAPH?: () => Promise<unknown>; readonly EVALUATE?: () => Promise<unknown>; readonly REPORT?: () => Promise<unknown> }

export class ScientificValidationCoordinator {
  private readonly config: ScientificValidationConfig; private readonly now: () => string
  constructor(config: ScientificValidationConfig, now: () => string = () => new Date().toISOString()) { this.config = config; this.now = now }
  async run(handlers: ValidationStageHandlers): Promise<ValidationRunResult> { const runId = `run-${this.now().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`; const outputDirectory = resolve(this.config.outputRoot, runId); mkdirSync(outputDirectory, { recursive: true }); this.write('config.json', this.config, outputDirectory); this.write('run-snapshot.json', { runId, caseId: this.config.caseId, modelRoute: this.config.modelRoute, modelIdentifier: this.config.modelIdentifier, skillVersions: this.config.skillVersions, provider: this.config.provider, corpusCutoff: this.config.corpusCutoff, createdAt: this.now() }, outputDirectory); const stages: StageRecord[] = []; for (const stage of VALIDATION_STAGES) { const startedAt = this.now(); try { const value = await handlers[stage]?.(); if (value !== undefined) this.write(`${stage.toLowerCase()}.json`, value, outputDirectory); const record = { stage, status: 'SUCCEEDED' as const, startedAt, completedAt: this.now(), artifactPaths: value === undefined ? [] : [`${stage.toLowerCase()}.json`] }; stages.push(record); this.write('stage-state.json', stages, outputDirectory) } catch (error) { const record = { stage, status: 'FAILED' as const, startedAt, completedAt: this.now(), artifactPaths: [], error: error instanceof Error ? error.message : 'stage failed' }; stages.push(record); this.write('stage-state.json', stages, outputDirectory); return { runId, outputDirectory, stages, failedStage: stage } } } return { runId, outputDirectory, stages } }
  private write(name: string, value: unknown, directory: string) { writeFileSync(resolve(directory, name), JSON.stringify(value, null, 2), 'utf8') }
}

export function validateExtractedDocumentForRun(document: ExtractedDocument, config: ScientificValidationConfig): { readonly quality: ExtractionQuality; readonly context: ReturnType<typeof boundDocumentContext> } { const quality = assessExtraction(document); requireExtractionPass(quality, config.extractionOverride ?? false); return { quality, context: boundDocumentContext(document, config.maxContextCharacters ?? 24000) } }
export function modelAttemptsForPersistence(gateway: Pick<ResponsesModelGateway, 'attempts'>): readonly ModelAttemptRecord[] { return gateway.attempts.map(attempt => ({ ...attempt })) }
