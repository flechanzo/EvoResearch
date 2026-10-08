declare module 'node:child_process' {
  export interface SpawnSyncResult { readonly status: number | null; readonly error?: Error; readonly stdout: Uint8Array | string; readonly stderr: Uint8Array | string }
  export function spawnSync(command: string, args?: readonly string[], options?: { readonly encoding?: string; readonly timeout?: number; readonly maxBuffer?: number; readonly shell?: boolean }): SpawnSyncResult
}
