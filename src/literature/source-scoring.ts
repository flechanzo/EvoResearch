import type { LiteratureQuery, LiteratureRecord } from './literature.ts'

// Ordinary function words only; domain terms and negation remain scoreable.
export const SOURCE_SELECT_STOPWORDS: readonly string[] = Object.freeze([
  'a', 'an', 'and', 'are', 'as', 'at', 'based', 'be', 'been', 'being', 'by',
  'can', 'for', 'from', 'had', 'has', 'have', 'in', 'into', 'is', 'it', 'its',
  'of', 'on', 'or', 'the', 'their', 'these', 'this', 'those', 'to', 'was',
  'were', 'will', 'with',
])
const stopwords = new Set(SOURCE_SELECT_STOPWORDS)

// Maximal Unicode letter/number sequences. Hyphens, slashes, underscores and
// other punctuation delimit tokens. No stemming, transliteration or fuzziness.
export function tokenizeLiteratureText(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
}

export function normalizeQueryTerms(text: string): { readonly tokens: readonly string[]; readonly removedStopwords: readonly string[] } {
  const distinct = [...new Set(tokenizeLiteratureText(text))]
  return { tokens: distinct.filter(token => !stopwords.has(token)), removedStopwords: distinct.filter(token => stopwords.has(token)) }
}

export interface LiteratureCandidateScore {
  readonly normalizedQueryTokens: readonly string[]
  readonly removedStopwords: readonly string[]
  readonly matchedTokens: readonly string[]
  readonly titleMatches: readonly string[]
  readonly abstractMatches: readonly string[]
  readonly lexicalScore: number
  readonly identifierBonus: number
  readonly dateBonus: number
  readonly totalScore: number
}

export function scoreLiteratureCandidate(record: LiteratureRecord, query: LiteratureQuery): LiteratureCandidateScore {
  const normalized = normalizeQueryTerms(query.query)
  const title = new Set(tokenizeLiteratureText(record.title))
  const abstract = new Set(tokenizeLiteratureText(record.abstract ?? ''))
  const matchedTokens = normalized.tokens.filter(token => title.has(token) || abstract.has(token))
  const lexicalScore = matchedTokens.length * 10
  const identifierBonus = record.doi ? 3 : record.openAlexId || record.arxivId ? 2 : record.urls.length ? 1 : 0
  const dateBonus = query.corpusCutoff && record.publicationDate && record.publicationDate <= query.corpusCutoff ? 1 : 0
  return {
    normalizedQueryTokens: normalized.tokens, removedStopwords: normalized.removedStopwords,
    matchedTokens, titleMatches: normalized.tokens.filter(token => title.has(token)),
    abstractMatches: normalized.tokens.filter(token => abstract.has(token)),
    lexicalScore, identifierBonus, dateBonus, totalScore: lexicalScore + identifierBonus + dateBonus,
  }
}
