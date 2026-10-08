declare module 'node:fs' {
  export function existsSync(path: string): boolean
  export function mkdirSync(path: string, options?: { readonly recursive?: boolean }): string | undefined
  export function writeFileSync(path: string, data: string, encoding?: string): void
  export function renameSync(oldPath: string, newPath: string): void
  export function unlinkSync(path: string): void
  export function readFileSync(path: string, encoding: 'utf8'): string
  export function readFileSync(path: string): Uint8Array
  export function rmSync(path: string, options?: { readonly recursive?: boolean; readonly force?: boolean }): void
  export function readdirSync(path: string): string[]
}
