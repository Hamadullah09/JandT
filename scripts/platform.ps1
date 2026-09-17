<#
.SYNOPSIS
  Inaaya Commerce Platform - start, stop, status, logs, backup, restore, test.

.DESCRIPTION
  One entry point for running the platform on a Windows machine with Docker
  Desktop. START.cmd and STOP.cmd call this.

    powershell -ExecutionPolicy Bypass -File scripts\platform.ps1 start
    powershell -ExecutionPolicy Bypass -File scripts\platform.ps1 status
    powershell -ExecutionPolicy Bypass -File scripts\platform.ps1 logs [service]
    powershell -ExecutionPolicy Bypass -File scripts\platform.ps1 backup
    powershell -ExecutionPolicy Bypass -File scripts\platform.ps1 restore backups\inaaya-....dump
    powershell -ExecutionPolicy Bypass -File scripts\platform.ps1 test
    powershell -ExecutionPolicy Bypass -File scripts\platform.ps1 demo-data
    powershell -ExecutionPolicy Bypass -File scripts\platform.ps1 stop
#>
param(
  [Parameter(Position = 0)] [ValidateSet('start', 'stop', 'status', 'logs', 'backup', 'restore', 'test', 'rebuild', 'import-legacy', 'demo-data')] [string] $Command = 'start',
  [Parameter(Position = 1)] [string] $Argument
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Say([string] $text, [string] $color = 'Gray') { Write-Host "  $text" -ForegroundColor $color }

# Written for Windows PowerShell 5.1 as well as PowerShell 7: START.cmd runs
# whichever `powershell` the machine has.
function New-Secret([int] $bytes = 36) {
  $buffer = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buffer)
  ([Convert]::ToBase64String($buffer)).Replace('+', 'A').Replace('/', 'B').Replace('=', '')
}

function Get-GatewayPort {
  $port = (Read-Env)['GATEWAY_PORT']
  if ($port) { $port } else { '5080' }
}

function Read-Env {
  $values = @{}
  if (Test-Path "$Root\.env") {
    Get-Content "$Root\.env" | Where-Object { $_ -match '^[A-Z0-9_]+=' } | ForEach-Object {
      $key, $value = $_ -split '=', 2
      $values[$key] = $value
    }
  }
  $values
}

function Ensure-Env {
  if (Test-Path "$Root\.env") { return }
  Say 'First run: creating .env with new random secrets' Cyan
  $text = Get-Content "$Root\.env.example" -Raw
  $text = $text -replace 'POSTGRES_PASSWORD=.*', "POSTGRES_PASSWORD=$(New-Secret 24)"
  $text = $text -replace 'WAREHOUSE_DB_PASSWORD=.*', "WAREHOUSE_DB_PASSWORD=$(New-Secret 24)"
  $text = $text -replace 'COURIER_DB_PASSWORD=.*', "COURIER_DB_PASSWORD=$(New-Secret 24)"
  $text = $text -replace 'AUTH_JWT_SECRET=.*', "AUTH_JWT_SECRET=$(New-Secret 48)"
  [System.IO.File]::WriteAllText("$Root\.env", $text, (New-Object System.Text.UTF8Encoding $false))
}

function Ensure-Docker {
  docker info *> $null
  if ($LASTEXITCODE -eq 0) { return }
  $desktop = @("$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe", "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $desktop) { throw 'Docker Desktop is not installed. Install it from https://www.docker.com/products/docker-desktop/' }
  Say 'Starting Docker Desktop...' Cyan
  Start-Process $desktop
  for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 2
    docker info *> $null
    if ($LASTEXITCODE -eq 0) { return }
  }
  throw 'Docker Desktop did not start within three minutes.'
}

function Wait-Healthy([int] $seconds = 600) {
  $port = Get-GatewayPort
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $gateway = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 "http://localhost:$port/api/health"
      $portal = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 "http://localhost:$port/login"
      if ($gateway.StatusCode -eq 200 -and $portal.StatusCode -eq 200) { return $true }
    } catch { }
    Start-Sleep -Seconds 3
  }
  return $false
}

function Show-Addresses {
  $port = Get-GatewayPort
  Write-Host ''
  Say "Platform:            http://localhost:$port" Green
  Say "Warehouse dashboard: http://localhost:$port/warehouse/" Green
  Say "Courier admin:       http://localhost:$port/admin" Green
  Say "Parcel tracking:     http://localhost:$port/tracking" Green
  Write-Host ''
  Say 'Handhelds on this network - put this address in Settings (or let them search):'
  Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and $_.PrefixOrigin -ne 'WellKnown' } |
    ForEach-Object { Say "    http://$($_.IPAddress):$port" }
  Write-Host ''
}

switch ($Command) {
  'start' {
    Write-Host ''
    Say 'Inaaya Commerce Platform' White
    Say '========================' White
    Ensure-Env
    Ensure-Docker
    Say 'Starting (the first start builds the images and takes several minutes)...' Cyan
    docker compose up -d --build
    if ($LASTEXITCODE -ne 0) { throw 'docker compose up failed - see the output above.' }
    Say 'Waiting for every service to report healthy...' Cyan
    if (Wait-Healthy) {
      Say 'Ready.' Green
      Show-Addresses
      Start-Process "http://localhost:$(Get-GatewayPort)"
    } else {
      Say 'The platform did not become healthy. Current state:' Yellow
      docker compose ps
      Say 'See the logs with:  scripts\platform.ps1 logs' Yellow
      exit 1
    }
  }
  'rebuild' {
    Ensure-Docker
    docker compose build --pull
    docker compose up -d
  }
  'stop' {
    docker compose down
    Say 'Stopped. Data is kept in the Docker volumes; START.cmd brings it all back.' Green
  }
  'status' {
    docker compose ps
    Show-Addresses
  }
  'logs' {
    if ($Argument) { docker compose logs -f --tail 200 $Argument } else { docker compose logs -f --tail 100 }
  }
  'backup' {
    $envs = Read-Env
    New-Item -ItemType Directory -Force "$Root\backups" | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $file = "$Root\backups\inaaya-$stamp.dump"
    Say "Backing up database '$($envs.POSTGRES_DB)' to $file" Cyan
    docker exec inaaya-postgres pg_dump -U $envs.POSTGRES_USER -d $envs.POSTGRES_DB --format=custom --file=/tmp/backup.dump
    if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed' }
    docker cp inaaya-postgres:/tmp/backup.dump $file
    docker exec inaaya-postgres rm -f /tmp/backup.dump
    $uploads = "$Root\backups\uploads-$stamp.zip"
    $photos = if ($envs.WAREHOUSE_UPLOADS_DIR) { $envs.WAREHOUSE_UPLOADS_DIR } else { "$Root\apps\warehouse\server\Warehouse.Api\uploads" }
    if (Test-Path $photos) { Compress-Archive -Path "$photos\*" -DestinationPath $uploads -Force }
    Say "Done: $file ($([math]::Round((Get-Item $file).Length / 1MB, 1)) MB) and product photos in $uploads" Green
  }
  'restore' {
    if (-not $Argument -or -not (Test-Path $Argument)) { throw 'Give the backup file: scripts\platform.ps1 restore backups\inaaya-....dump' }
    $envs = Read-Env
    Say "Restoring $Argument into '$($envs.POSTGRES_DB)'. Everything currently in the database is replaced." Yellow
    $answer = Read-Host '  Type RESTORE to continue'
    if ($answer -ne 'RESTORE') { Say 'Cancelled.'; return }
    docker compose stop gateway warehouse-api courier-api courier-web
    docker cp $Argument inaaya-postgres:/tmp/restore.dump
    docker exec inaaya-postgres pg_restore -U $envs.POSTGRES_USER -d $envs.POSTGRES_DB --clean --if-exists --no-owner --role=$($envs.POSTGRES_USER) /tmp/restore.dump
    docker exec inaaya-postgres rm -f /tmp/restore.dump
    docker compose up -d
    Say 'Restored.' Green
  }
  'test' {
    Say 'Cross-module checks against the running platform' Cyan
    node "$Root\tests\e2e\platform.mjs" "http://localhost:$(Get-GatewayPort)"
  }
  'demo-data' {
    # Invented customers, orders and parcels, so the platform can be shown and
    # tried out without a real customer's name, phone number or address on the
    # screen. The catalogue, the stock and the accounts are left as they are.
    $envs = Read-Env
    Say 'Demo data: invented customers, orders and J&T parcels.' Cyan
    Say 'The catalogue, the garments on the shelves and the accounts stay as they are.' Cyan
    $answer = Read-Host '  This REPLACES every order, parcel and customer. Type DEMO to continue'
    if ($answer -ne 'DEMO') { Say 'Cancelled.'; return }
    python "$Root\database\tools\demo_data.py" `
      --pg "postgresql://$($envs.POSTGRES_USER):$($envs.POSTGRES_PASSWORD)@127.0.0.1:$($envs.POSTGRES_HOST_PORT)/$($envs.POSTGRES_DB)" `
      --url "http://localhost:$(Get-GatewayPort)" --yes
    if ($LASTEXITCODE -ne 0) { throw 'The demo data failed.' }
    Say 'Demo data is in. The real data goes back with: platform.ps1 import-legacy' Green
  }

  'import-legacy' {
    # The one-time move of the two old systems' data into the platform - see
    # docs/MIGRATION.md. Replaces the warehouse and courier orders in the database.
    $envs = Read-Env
    $dump = if ($Argument) { $Argument } else {
      Get-ChildItem "$Root\database\legacy\mysql-backups\*.sql" | Sort-Object LastWriteTime | Select-Object -Last 1 -ExpandProperty FullName
    }
    $export = Get-ChildItem "$Root\apps\courier\exports\orders_*.csv" -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime | Select-Object -Last 1 -ExpandProperty FullName
    Say "Warehouse data: $dump" Cyan
    Say "Courier data:   $export" Cyan
    $answer = Read-Host '  This REPLACES the warehouse and courier orders in the platform database. Type IMPORT to continue'
    if ($answer -ne 'IMPORT') { Say 'Cancelled.'; return }
    $arguments = @("$Root\database\tools\migrate_legacy.py",
      '--pg', "postgresql://$($envs.POSTGRES_USER):$($envs.POSTGRES_PASSWORD)@127.0.0.1:$($envs.POSTGRES_HOST_PORT)/$($envs.POSTGRES_DB)",
      '--mysql-dump', $dump, '--mysql-timezone', 'Asia/Karachi', '--replace')
    if ($export) { $arguments += @('--courier-export', $export) }
    python @arguments
    if ($LASTEXITCODE -ne 0) { throw 'The import failed - nothing was changed.' }
    docker compose restart warehouse-api | Out-Null
    Say 'Imported. The warehouse API was restarted to read the imported photos.' Green
  }
}
