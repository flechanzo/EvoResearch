declare module 'node:fs' { export function existsSync(path: string): boolean }
declare module 'node:path' { export function resolve(...paths: string[]): string; export function basename(path: string): string }
declare module 'node:url' { export function fileURLToPath(url: URL): string }
declare module 'node:process' { export const env: Record<string, string | undefined> }
