<#
.SYNOPSIS
    Install the motionbrief skill into your Claude config.

.DESCRIPTION
    Copies the skill and the /motion command into a Claude home directory.

.PARAMETER Project
    Install into .\.claude for this project only, instead of the user config.

.PARAMETER Target
    Explicit Claude home directory. Defaults to $HOME\.claude

.PARAMETER DryRun
    Print what would happen without writing anything.

.EXAMPLE
    .\install.ps1

.EXAMPLE
    .\install.ps1 -Project

.EXAMPLE
    .\install.ps1 -Target D:\claude-config -DryRun
#>
[CmdletBinding()]
param(
    [switch]$Project,
    [string]$Target,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$RepoDir = $PSScriptRoot
if (-not $RepoDir) { $RepoDir = (Get-Location).Path }

$SkillName = "motionbrief"
$SkillSrc  = Join-Path $RepoDir "skills\$SkillName"
$CmdSrc    = Join-Path $RepoDir ".claude\commands\motion.md"

if ($Target) {
    $ClaudeHome = $Target
} elseif ($Project) {
    $ClaudeHome = Join-Path (Get-Location).Path ".claude"
} else {
    $ClaudeHome = Join-Path $HOME ".claude"
}

if (-not (Test-Path (Join-Path $SkillSrc "SKILL.md"))) {
    Write-Error "skill source not found at $SkillSrc - run this script from a clone of the repository."
    exit 1
}

Write-Host "motionbrief installer"
Write-Host "  from    $RepoDir"
Write-Host "  into    $ClaudeHome"
Write-Host ""

$SkillDst = Join-Path $ClaudeHome "skills\$SkillName"
$CmdDst   = Join-Path $ClaudeHome "commands\motion.md"

if ($DryRun) {
    Write-Host "  would copy $SkillSrc -> $SkillDst"
    Write-Host "  would copy $CmdSrc   -> $CmdDst"
    exit 0
}

New-Item -ItemType Directory -Force -Path (Join-Path $ClaudeHome "skills")   | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $ClaudeHome "commands") | Out-Null

if (Test-Path $SkillDst) { Remove-Item -Recurse -Force $SkillDst }
Copy-Item -Recurse -Force $SkillSrc $SkillDst
Copy-Item -Force $CmdSrc $CmdDst

# Never ship engine caches from a local run.
foreach ($cache in @(".hyperframes", "renders")) {
    Get-ChildItem -Path $SkillDst -Recurse -Directory -Filter $cache -ErrorAction SilentlyContinue |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "  installed skill    $SkillDst"
Write-Host "  installed command  $CmdDst"
Write-Host ""

# --- optional dependency checks ------------------------------------------

$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
    Write-Host "  node      $(node --version)"
} else {
    Write-Host "  node      MISSING - install Node 18 or newer"
}

$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
if ($ffmpeg) {
    Write-Host "  ffmpeg    $($ffmpeg.Source)"
} else {
    Write-Host "  ffmpeg    MISSING - needed to render with HyperFrames."
    Write-Host "            winget install --id Gyan.FFmpeg -e"
    Write-Host "            (lint, check and snapshot work without it)"
}

Write-Host ""
Write-Host "Done. Restart Claude Code, then:"
Write-Host "  /motion a 10 second launch video for a note-taking app"
