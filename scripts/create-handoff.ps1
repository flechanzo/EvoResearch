[CmdletBinding()]
param(
  [string]$RepositoryRoot = $null,
  [string]$ArchivePath = $null
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $RepositoryRoot) { $RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path }
if (-not $ArchivePath) { $ArchivePath = Join-Path $RepositoryRoot 'EvoResearch-Handoff.zip' }
$staging = Join-Path $RepositoryRoot '.handoff-staging'

function Write-Utf8([string]$Path, [string]$Text) {
  $parent = Split-Path -Parent $Path
  if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  Set-Content -LiteralPath $Path -Value $Text -Encoding UTF8
}

function Copy-Safe([string]$Source, [string]$RelativeDestination) {
  if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) { return }
  $destination = Join-Path $staging $RelativeDestination
  $parent = Split-Path -Parent $destination
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  Copy-Item -LiteralPath $Source -Destination $destination -Force
}

function Invoke-StatusCommand([string]$CommandName, [string[]]$Arguments) {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $executable = if (Get-Command "$CommandName.cmd" -ErrorAction SilentlyContinue) { "$CommandName.cmd" } else { $CommandName }
  $output = & $executable @Arguments 2>&1
  $ErrorActionPreference = $previousPreference
  $exitCode = $LASTEXITCODE
  [pscustomobject]@{ ExitCode = $exitCode; Output = ($output -join "`n") }
}

if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
New-Item -ItemType Directory -Force -Path $staging | Out-Null

# The handoff prose is authored in the repository and copied as-is.
if (Test-Path -LiteralPath (Join-Path $RepositoryRoot 'handoff')) {
  Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'handoff') -Destination $staging -Recurse -Force
}

# Root files needed to understand and validate the snapshot.
foreach ($file in @('AGENTS.md', 'PROJECT_SPEC.md', 'TASKS.md', 'package.json', 'tsconfig.json')) {
  Copy-Safe (Join-Path $RepositoryRoot $file) (Join-Path 'source' $file)
}

# Keep the source snapshot explicit. This avoids generated trees, PDFs, virtualenvs,
# node_modules, .git, and unrelated local scratch data.
foreach ($directory in @('src', 'examples', 'tests', 'docs', '.agents')) {
  $sourceDirectory = Join-Path $RepositoryRoot $directory
  if (Test-Path -LiteralPath $sourceDirectory -PathType Container) {
    Get-ChildItem -LiteralPath $sourceDirectory -Recurse -File |
      Where-Object { $_.Extension -notin @('.pdf', '.zip') -and $_.FullName -notmatch '[\\/]outputs([\\/]|$)' } |
      ForEach-Object {
        $relative = $_.FullName.Substring($RepositoryRoot.Length).TrimStart('\', '/')
        Copy-Safe $_.FullName (Join-Path 'source' $relative)
      }
  }
}
Copy-Safe (Join-Path $RepositoryRoot 'scripts/create-handoff.ps1') (Join-Path 'source/scripts' 'create-handoff.ps1')

# Evaluation definitions and annotations are useful; papers and generated output trees are not.
$evaluationRoot = Join-Path $RepositoryRoot 'evaluation'
if (Test-Path -LiteralPath $evaluationRoot -PathType Container) {
  Get-ChildItem -LiteralPath $evaluationRoot -Recurse -File |
    Where-Object {
      $_.Extension -notin @('.pdf', '.zip') -and
      $_.FullName -notmatch '[\\/]outputs([\\/]|$)' -and
      $_.FullName -notmatch '[\\/]papers([\\/]|$)'
    } |
    ForEach-Object {
      $relative = $_.FullName.Substring($RepositoryRoot.Length).TrimStart('\', '/')
      Copy-Safe $_.FullName (Join-Path 'source' $relative)
    }
}

# Generate compact state files inside the archive.
$status = Invoke-StatusCommand 'git' @('-C', $RepositoryRoot, 'status', '--short')
$commit = Invoke-StatusCommand 'git' @('-C', $RepositoryRoot, 'rev-parse', 'HEAD')
$history = Invoke-StatusCommand 'git' @('-C', $RepositoryRoot, 'log', '-10', '--oneline')
$statusOutput = (($status.Output -split "`n") | Where-Object { $_ -notmatch '\.handoff-staging' }) -join "`n"
Write-Utf8 (Join-Path $staging '06_GIT_STATE.txt') @"
Repository: $RepositoryRoot
git status --short exit code: $($status.ExitCode)
$statusOutput

git rev-parse HEAD exit code: $($commit.ExitCode)
$($commit.Output)

git log -10 --oneline exit code: $($history.ExitCode)
$($history.Output)
"@
Write-Utf8 (Join-Path $staging 'GIT_COMMIT.txt') $commit.Output
Write-Utf8 (Join-Path $staging 'GIT_RECENT_HISTORY.txt') $history.Output

$treeLines = Get-ChildItem -LiteralPath $RepositoryRoot -Recurse -File -Force |
  Where-Object {
    $_.FullName -notmatch '[\\/]\.git([\\/]|$)' -and
    $_.FullName -notmatch '[\\/]\.venv([\\/]|$)' -and
    $_.FullName -notmatch '[\\/]node_modules([\\/]|$)' -and
    $_.Extension -notin @('.pdf', '.zip') -and
    $_.FullName -notmatch '[\\/]outputs([\\/]|$)' -and
    $_.FullName -notmatch '[\\/]\.handoff-staging([\\/]|$)'
  } |
  ForEach-Object { $_.FullName.Substring($RepositoryRoot.Length).TrimStart('\', '/') } |
  Sort-Object
Write-Utf8 (Join-Path $staging '05_REPOSITORY_TREE.txt') (($treeLines -join "`n") + "`n")

$test = Invoke-StatusCommand 'npm' @('test')
$typecheck = Invoke-StatusCommand 'npm' @('run', 'typecheck')
Write-Utf8 (Join-Path $staging '07_TEST_STATE.txt') @"
Commands were executed by create-handoff.ps1 in the local workspace.
npm test: exit code $($test.ExitCode)
npm run typecheck: exit code $($typecheck.ExitCode)
No live validation command is run by this script.
No OpenAlex request is made by this script.
"@

Write-Utf8 (Join-Path $staging '08_ENVIRONMENT_TEMPLATE.txt') @'
EVORESEARCH_MODEL_BASE_URL=<REDACTED>
EVORESEARCH_MODEL_API_KEY=<REDACTED>
EVORESEARCH_MODEL=<MODEL_NAME>
EVORESEARCH_MODEL_PROVIDER=<PROVIDER_NAME>
EVORESEARCH_MODEL_STRUCTURED_OUTPUT_MODE=prompt_json
EVORESEARCH_MODEL_STREAMING=required
EVORESEARCH_PYTHON=<PYTHON_EXECUTABLE_OR_REDACTED>
'@

# Copy only small, selected diagnostics from the newest known run. Never copy a PDF,
# generated output tree, or a full config without the secret scan below.
$candidateRoots = @(
  (Join-Path $RepositoryRoot 'outputs'),
  (Join-Path $RepositoryRoot 'evaluation/real-paper/cases/first-three/outputs')
) | Where-Object { Test-Path -LiteralPath $_ -PathType Container }
$runs = foreach ($root in $candidateRoots) {
  Get-ChildItem -LiteralPath $root -Recurse -Directory -Filter 'run-*' -ErrorAction SilentlyContinue
}
$latest = $runs | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($latest) {
  $diag = Join-Path $staging 'diagnostics/latest-run'
  New-Item -ItemType Directory -Force -Path $diag | Out-Null
  foreach ($name in @('stage-state.json', 'run-snapshot.json', 'extraction-report.json', 'model-attempts.json', 'config.json')) {
    $source = Join-Path $latest.FullName $name
    if (Test-Path -LiteralPath $source -PathType Leaf) { Copy-Item -LiteralPath $source -Destination (Join-Path $diag $name) -Force }
  }
  $failed = Join-Path $latest.FullName 'paper-reader/failed-attempts'
  if (Test-Path -LiteralPath $failed -PathType Container) {
    Get-ChildItem -LiteralPath $failed -Recurse -File |
      Where-Object { $_.Length -le 1048576 -and $_.Extension -in @('.json', '.txt') } |
      ForEach-Object {
        $relative = $_.FullName.Substring($latest.FullName.Length).TrimStart('\', '/')
        Copy-Safe $_.FullName (Join-Path 'diagnostics/latest-run' $relative)
      }
  }
  Write-Utf8 (Join-Path $diag 'README.txt') "Selected from newest run: $($latest.FullName)`nOnly bounded JSON/TXT diagnostics are copied; PDFs and generated output trees are excluded.`n"
} else {
  Write-Utf8 (Join-Path $staging 'diagnostics/latest-run/README.txt') 'No run-* directory was found; no diagnostics were copied.'
}

# Scan before creating the archive. Report only path and category, never matching content.
$findings = @()
$patterns = @(
  @{ Name = 'authorization-bearer'; Regex = '(?i)Authorization\s*:\s*Bearer\s+(?:sk-|rk-|sess-|AIza)[A-Za-z0-9._~+/=-]{12,}' },
  @{ Name = 'bearer-token'; Regex = '(?i)\bBearer\s+(?:sk-|rk-|sess-|AIza)[A-Za-z0-9._~+/=-]{12,}' },
  @{ Name = 'apiKey-value'; Regex = '(?i)\bapiKey\b\s*[:=]\s*["''](?!<REDACTED>)(?!REDACTED\b)(?:sk-|rk-|sess-|AIza)[A-Za-z0-9._~+/=-]{12,}["'']' },
  @{ Name = 'model-api-key'; Regex = '(?i)EVORESEARCH_MODEL_API_KEY\s*=\s*["'']?(?:sk-|rk-|sess-|AIza)[A-Za-z0-9._~+/=-]{12,}["'']?' },
  @{ Name = 'env-secret'; Regex = '(?i)\b(?:OPENAI|DEEPSEEK|MY_RELAY|ANTHROPIC|GEMINI)[A-Z0-9_]*(?:KEY|TOKEN|SECRET)\s*=\s*["'']?(?:sk-|rk-|sess-|AIza)[A-Za-z0-9._~+/=-]{12,}["'']?' },
  @{ Name = 'env-secret-generic'; Scope = 'non-code'; Regex = '(?i)\b[A-Z][A-Z0-9_]*(?:API_KEY|SECRET|TOKEN)\s*=\s*["'']?(?!<REDACTED>)(?!REDACTED\b)[A-Za-z0-9._~+/=-]{16,}["'']?' }
)
Get-ChildItem -LiteralPath $staging -Recurse -File -Force | ForEach-Object {
  $file = $_
  try { $text = Get-Content -LiteralPath $file.FullName -Raw -ErrorAction Stop } catch { return }
  $relative = $file.FullName.Substring($staging.Length).TrimStart('\', '/')
  $isCode = $relative -match '^source[\\/](src|tests|examples|scripts)[\\/]'
  foreach ($pattern in $patterns) {
    if (($pattern.PSObject.Properties.Name -contains 'Scope') -and $pattern.Scope -eq 'non-code' -and $isCode) { continue }
    if ([regex]::IsMatch($text, $pattern.Regex)) {
      $findings += "$relative :: $($pattern.Name)"
    }
  }
}
if ($findings.Count -gt 0) {
  Write-Output 'SECURITY WARNING'
  $findings | Sort-Object -Unique | ForEach-Object { Write-Output $_ }
  throw 'ZIP creation aborted because the staging tree matched a secret pattern.'
}

if (Test-Path -LiteralPath $ArchivePath -PathType Leaf) { Remove-Item -LiteralPath $ArchivePath -Force }
Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $ArchivePath -CompressionLevel Optimal
Remove-Item -LiteralPath $staging -Recurse -Force
Write-Output "Created $ArchivePath"
