$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $projectRoot ".local-dev-server.pid"
$basePort = 3000
$maxPort = 3010

function Stop-ProcessTree {
  param([int]$ProcessId)
  if ($ProcessId -le 0) { return }
  $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($proc) {
    # taskkill closes the process and all of its children in one operation.
    $result = Start-Process -FilePath "taskkill.exe" -ArgumentList @(
      "/PID", $ProcessId, "/T", "/F"
    ) -Wait -PassThru -WindowStyle Hidden -ErrorAction SilentlyContinue
    if ($result -and $result.ExitCode -eq 0) {
      Write-Host "Stopped process tree: $ProcessId ($($proc.ProcessName))"
    } else {
      Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
}

function Get-ListenerProcessIds {
  try {
    return @(
      # Query once instead of making one slow system call per port.
      Get-NetTCPConnection -State Listen -ErrorAction Stop |
        Where-Object { $_.LocalPort -ge $basePort -and $_.LocalPort -le $maxPort } |
        Select-Object -ExpandProperty OwningProcess -Unique
    )
  } catch {
    return @()
  }
}

$stopped = @{}

if (Test-Path $pidFile) {
  $rawPid = (Get-Content -Path $pidFile -Raw).Trim()
  if ($rawPid -match "^\d+$") {
    Stop-ProcessTree -ProcessId ([int]$rawPid)
    $stopped[[int]$rawPid] = $true
  }
  Remove-Item $pidFile -Force
}

foreach ($procId in (Get-ListenerProcessIds)) {
  if ($stopped.ContainsKey($procId)) { continue }
  Stop-ProcessTree -ProcessId $procId
  $stopped[$procId] = $true
}

if ($stopped.Count -eq 0) {
  Write-Host "No local dev server process found on ports $basePort-$maxPort."
} else {
  Write-Host "Local dev server stopped."
}
