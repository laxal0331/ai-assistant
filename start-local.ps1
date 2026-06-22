$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$basePort = 3000
$maxPort = 3010
$pidFile = Join-Path $projectRoot ".local-dev-server.pid"
$stopScript = Join-Path $projectRoot "stop-local.ps1"

Write-Host "==> Project root: $projectRoot"

function Get-LanIpv4 {
  try {
    $candidates = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
      Where-Object {
        $_.IPAddress -notlike "127.*" -and
        $_.IPAddress -notlike "169.254.*" -and
        $_.PrefixOrigin -ne "WellKnown"
      } |
      Sort-Object InterfaceMetric, SkipAsSource

    $private = @($candidates | Where-Object {
      $_.IPAddress -match "^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)"
    })
    if ($private.Count -gt 0) { return $private[0].IPAddress }
    if ($candidates.Count -gt 0) { return $candidates[0].IPAddress }
  } catch {
    # fall through
  }
  return $null
}

function Test-PortListening {
  param([int]$Port)
  try {
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop
    return [bool]$conn
  } catch {
    return $false
  }
}

function Test-Health {
  param([int]$Port)
  # Use IPv4 explicitly because the dev server listens on 0.0.0.0.
  $healthUrl = "http://127.0.0.1:$Port/health"
  try {
    $resp = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
    return ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500)
  } catch {
    return $false
  }
}

function Open-Browser {
  param([string]$Url)
  Write-Host "==> Opening PC URL: $Url"
  $browserCandidates = @(
    @{ Path = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"; NewWindow = "--new-window" },
    @{ Path = "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"; NewWindow = "--new-window" },
    @{ Path = "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"; NewWindow = "--new-window" },
    @{ Path = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"; NewWindow = "--new-window" },
    @{ Path = "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"; NewWindow = "--new-window" }
  )

  foreach ($browser in $browserCandidates) {
    if (-not (Test-Path $browser.Path)) { continue }
    try {
      Start-Process -FilePath $browser.Path -ArgumentList @($browser.NewWindow, $Url) | Out-Null
      return
    } catch {
      # Try the next installed browser.
    }
  }

  try {
    Start-Process -FilePath $Url | Out-Null
  } catch {
    Write-Warning "Could not open browser automatically. Please open: $Url"
  }
}

function Wait-ForHealth {
  param([int]$Port, [int]$MaxAttempts = 40)
  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt += 1) {
    if (Test-Health -Port $Port) { return $true }
    Start-Sleep -Milliseconds 800
  }
  return $false
}

function Select-Port {
  for ($p = $basePort; $p -le $maxPort; $p += 1) {
    if (Test-Health -Port $p) {
      return @{ Port = $p; Reuse = $true }
    }
    if (-not (Test-PortListening -Port $p)) {
      return @{ Port = $p; Reuse = $false }
    }
  }
  return $null
}

# Clean stale node listeners on 3000 so we don't skip to 3001 silently.
if ((Test-PortListening -Port $basePort) -and -not (Test-Health -Port $basePort)) {
  Write-Host "==> Port $basePort is occupied by an unhealthy process. Cleaning up..."
  & $stopScript
  Start-Sleep -Seconds 1
}

$selection = Select-Port
if (-not $selection) {
  throw "No available port found in range $basePort-$maxPort. Run stop-local.bat and try again."
}

$selectedPort = $selection.Port
$reusing = $selection.Reuse

if ($reusing) {
  Write-Host "==> Reusing existing app server on port $selectedPort."
} else {
  Write-Host "==> Selected free port: $selectedPort"
  Write-Host "==> Starting dev server on port $selectedPort..."
  $proc = Start-Process powershell -PassThru -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location '$projectRoot'; `$env:PORT='$selectedPort'; npm.cmd run dev"
  )
  Set-Content -Path $pidFile -Value $proc.Id -Encoding ascii

  Write-Host "==> Waiting for server readiness..."
  if (-not (Wait-ForHealth -Port $selectedPort)) {
    if (Test-Path $stopScript) {
      & $stopScript
    } elseif (Test-Path $pidFile) {
      Remove-Item $pidFile -Force
    }
    throw "Server was not ready in time. Check the dev server terminal logs."
  }
}

$lanIp = Get-LanIpv4
$localhostUrl = "http://localhost:$selectedPort"
$mobileUrl = if ($lanIp) { "http://${lanIp}:$selectedPort" } else { $localhostUrl }

Write-Host "==> Server is ready."
Write-Host "    PC (本机):     $localhostUrl"
if ($lanIp) {
  Write-Host "    手机/局域网:   $mobileUrl"
  Write-Host "    Audio capture must use the localhost URL on this PC."
} else {
  Write-Host "    (手机同步请手动改用局域网 IP 打开)"
}

Open-Browser $localhostUrl
Write-Host "==> Done."
