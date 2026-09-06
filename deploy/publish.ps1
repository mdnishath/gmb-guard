<#
  One-shot publish: GitHub public repo + Ubuntu VPS deployment.

    .\deploy\publish.ps1 -RepoName gmb-guard -Domain gmb.client-flow.xyz -VpsHost 144.79.218.148 -VpsPassword '...'

  Steps
    1. git init/commit, create (or reuse) the public GitHub repo with `gh`, push main
    2. build the server .env from .env.local (Google key etc.) + fresh secrets
    3. ssh (password) to the VPS: upload .env + deploy/remote-setup.sh and run it
#>
param(
  [string]$RepoName = 'gmb-guard',
  [string]$Domain = 'gmb.client-flow.xyz',
  [string]$VpsHost = '144.79.218.148',
  [string]$VpsUser = 'root',
  [string]$VpsPassword = $env:VPS_PASSWORD,
  [switch]$SkipGit
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
$root = Get-Location

function Step($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }

if (-not $VpsPassword) { throw "VPS password missing: pass -VpsPassword or set VPS_PASSWORD" }

# ---------------------------------------------------------------- 1. GitHub
$repoUrl = $null
if (-not $SkipGit) {
  Step "git repository"
  if (-not (Test-Path .git)) { git init -q; git branch -M main }
  git add -A
  if (git status --porcelain) { git commit -q -m "GMB Guard: full-stack Next.js app (SQLite, free Maps checks, auth, backups)" } else { Write-Host "nothing to commit" }

  $ghUser = (gh api user --jq .login)
  if (-not $ghUser) { throw "gh is not logged in. Run: gh auth login" }
  $exists = $true
  try { gh repo view "$ghUser/$RepoName" --json name | Out-Null } catch { $exists = $false }
  if (-not $exists) {
    Step "creating public repo $ghUser/$RepoName"
    gh repo create "$ghUser/$RepoName" --public --source . --remote origin --push | Out-Null
  } else {
    if (-not (git remote | Select-String -Quiet '^origin$')) { git remote add origin "https://github.com/$ghUser/$RepoName.git" }
    git push -u origin main
  }
  $repoUrl = "https://github.com/$ghUser/$RepoName.git"
  Write-Host "repo: $repoUrl"
} else {
  $repoUrl = (git remote get-url origin)
}

# ---------------------------------------------------------------- 2. server .env
Step "server .env"
$local = @{}
if (Test-Path .env.local) {
  Get-Content .env.local | ForEach-Object {
    if ($_ -match '^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$') { $local[$matches[1]] = $matches[2] }
  }
}
function Rand($n) { -join ((1..$n) | ForEach-Object { '0123456789abcdef'[(Get-Random -Maximum 16)] }) }
$envFile = Join-Path $root 'deploy\.vps.env'
$cronSecret = if ($local['CRON_SECRET'] -and $local['CRON_SECRET'] -notmatch 'change-me') { $local['CRON_SECRET'] } else { Rand 48 }
$lines = @(
  "DATABASE_PATH=./data/gmb.sqlite",
  "APP_SECRET=$(Rand 64)",
  "GOOGLE_PLACES_API_KEY=$($local['GOOGLE_PLACES_API_KEY'])",
  "GOOGLE_PLACES_API_VERSION=auto",
  "GOOGLE_API_DISABLED=$(if ($local['GOOGLE_API_DISABLED']) { $local['GOOGLE_API_DISABLED'] } else { '0' })",
  "GOOGLE_DAILY_CALL_LIMIT=10000",
  "DEFAULT_PHONE_COUNTRY_CODE=$(if ($local['DEFAULT_PHONE_COUNTRY_CODE']) { $local['DEFAULT_PHONE_COUNTRY_CODE'] } else { '33' })",
  "CRON_SECRET=$cronSecret",
  "CRON_SCHEDULE=0 3 * * *",
  "TELEGRAM_BOT_TOKEN=$($local['TELEGRAM_BOT_TOKEN'])",
  "TELEGRAM_CHAT_ID=$($local['TELEGRAM_CHAT_ID'])",
  "RESEND_API_KEY=$($local['RESEND_API_KEY'])",
  "ALERT_EMAIL_FROM=$($local['ALERT_EMAIL_FROM'])",
  "ALERT_EMAIL_TO=$($local['ALERT_EMAIL_TO'])",
  "GMB_CHECK_CONCURRENCY=10",
  "GMB_BATCH_DELAY_MS=0",
  "GOOGLE_PLACES_TIMEOUT_MS=8000",
  "APP_URL=https://$Domain",
  "NODE_ENV=production"
)
[System.IO.File]::WriteAllText($envFile, ($lines -join "`n") + "`n")
Write-Host "wrote $envFile (not committed)"

# ---------------------------------------------------------------- 3. VPS
Step "ssh helper (ssh2)"
if (-not (Test-Path (Join-Path $root 'deploy\node_modules\ssh2'))) {
  Push-Location (Join-Path $root 'deploy')
  if (-not (Test-Path package.json)) { '{ "name": "gmb-deploy-tools", "private": true }' | Set-Content -Encoding utf8 package.json }
  npm install --no-audit --no-fund --loglevel=error ssh2@1 | Out-Null
  Pop-Location
}

Step "deploying to $VpsUser@$VpsHost ($Domain)"
node deploy/remote.mjs --host $VpsHost --user $VpsUser --password $VpsPassword `
  --upload "$envFile`:/tmp/gmb.env" `
  --script deploy/remote-setup.sh `
  --env "DOMAIN=$Domain" --env "REPO_URL=$repoUrl" --env "APP_DIR=/var/www/gmb-guard"

Write-Host ""
Write-Host "Done. Repo: $repoUrl" -ForegroundColor Green
Write-Host "App:  https://$Domain  (create the first admin account on first visit)" -ForegroundColor Green
