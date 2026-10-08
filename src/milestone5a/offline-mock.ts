import type { ModelGateway, ModelGatewayResult, ModelRequest } from '../domain/extraction.ts'
import type { OfflineMockResponseMap } from './types.ts'

/**
 * An in-process ModelGateway for contract tests and offline replay fixtures.
 * It implements the existing gateway port and never creates an HTTP client.
 */
export class OfflineMockModelGateway implements ModelGateway {
  readonly calls: ModelRequest<unknown>[] = []
  readonly annotations: { readonly attemptId: string; readonly patch: Record<string, unknown> }[] = []
  private readonly responses: OfflineMockResponseMap

  constructor(responses: OfflineMockResponseMap = {}) {
    this.responses = responses
  }

  async structured<T>(request: ModelRequest<T>): Promise<ModelGatewayResult<T>> {
    this.calls.push(request as ModelRequest<unknown>)
    const configured = this.responses[request.role as 'PaperReader' | 'ProblemExtractor']
    const value = typeof configured === 'function' ? await configured(request) : configured ?? this.defaultResponse(request)
    if (isGatewayResult<T>(value)) return value
    return { ok: true, value: value as T, diagnostic: { attemptId: request.attemptId, model: request.route.model, normalizedTextPresent: true, parseStatus: 'success', schemaValidationStatus: 'not-attempted', status: 'SUCCEEDED', outputTrust: 'UNTRUSTED / UNVALIDATED' } }
  }

  annotateAttempt(attemptId: string, patch: Record<string, unknown>): void {
    this.annotations.push({ attemptId, patch })
  }

  private defaultResponse(request: ModelRequest<unknown>): unknown {
    if (request.role === 'PaperReader') return { artifactId: request.inputArtifactIds[0], schemaVersion: 'm5a-paper-reader@1', items: [] }
    return { nodes: [], edges: [] }
  }
}

function isGatewayResult<T>(value: unknown): value is ModelGatewayResult<T> {
  return Boolean(value && typeof value === 'object' && 'ok' in value && typeof (value as { ok?: unknown }).ok === 'boolean')
}

export function createOfflineMockModelGateway(responses: OfflineMockResponseMap = {}): OfflineMockModelGateway {
  return new OfflineMockModelGateway(responses)
}

export const createOfflineMockProvider = createOfflineMockModelGateway
export const OfflineMockProvider = OfflineMockModelGateway
