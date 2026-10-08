declare module 'node:crypto' {
  interface Hash {
    update(value: string, encoding?: string): Hash
    digest(encoding: 'hex'): string
  }

  export function createHash(algorithm: string): Hash
  export function randomUUID(): string
}
