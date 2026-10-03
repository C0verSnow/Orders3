param([Parameter(Mandatory = $true)][string]$Executable)
$ErrorActionPreference = "Stop"
$executablePath = (Resolve-Path -LiteralPath $Executable).Path
$taskTemporary = Join-Path ([IO.Path]::GetTempPath()) ("orders-smoke-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $taskTemporary | Out-Null
$oldData = $env:ORDERS_DATA_DIR
$oldConfig = $env:ORDERS_CONFIG_PATH
$oldOrigin = $env:ORDERS_ALLOWED_ORIGIN
$process = $null
try {
    $env:ORDERS_DATA_DIR = $taskTemporary
    $env:ORDERS_CONFIG_PATH = Join-Path $taskTemporary "config"
    $env:ORDERS_ALLOWED_ORIGIN = "http://127.0.0.1:8090"
    $process = Start-Process -FilePath $executablePath -ArgumentList @(
        "--cached", "--no-browser", "--port", "8090"
    ) -WorkingDirectory $taskTemporary -WindowStyle Hidden -PassThru
    $origin = "http://127.0.0.1:8090"
    $ready = $false
    for ($attempt = 0; $attempt -lt 100; $attempt++) {
        if ($process.HasExited) { throw "Application exited before readiness" }
        try {
            $data = Invoke-RestMethod "$origin/api/data"
            $ready = $true
            break
        } catch { Start-Sleep -Milliseconds 200 }
    }
    if (-not $ready) { throw "Application did not become ready" }
    if (@($data.items).Count -ne 0) { throw "Expected empty cache" }
    foreach ($route in @("/", "/app.js", "/style.css", "/logo.svg", "/api/orders")) {
        $response = Invoke-WebRequest "$origin$route"
        if ($response.StatusCode -ne 200) { throw "Route failed: $route" }
        if (-not $response.Headers["X-Content-Type-Options"]) { throw "Missing response headers" }
    }
    $schedule = Invoke-RestMethod "$origin/api/schedule" -Method Post -Headers @{
        Origin = $origin
    } -ContentType "application/json" -Body '{"enabled":false,"cron":"*/15 * * * *"}'
    if ($schedule.enabled -or -not (Test-Path -LiteralPath $env:ORDERS_CONFIG_PATH)) {
        throw "Schedule persistence failed"
    }
    try {
        Invoke-WebRequest "$origin/api/schedule" -Method Post -Headers @{
            Origin = "http://untrusted.example"
        } -ContentType "application/json" -Body '{"enabled":false,"cron":"*/15 * * * *"}'
        throw "Invalid origin was accepted"
    } catch {
        if ([int]$_.Exception.Response.StatusCode -ne 403) { throw }
    }
    try {
        Invoke-WebRequest "$origin/api/schedule" -Method Post -Headers @{
            Origin = $origin
        } -ContentType "application/json" -Body '{"enabled":true,"cron":"0 0 31 2 *"}'
        throw "Impossible cron was accepted"
    } catch {
        if ([int]$_.Exception.Response.StatusCode -ne 400) { throw }
    }
    Write-Output "C++ runtime smoke checks passed"
} finally {
    if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force }
    $env:ORDERS_DATA_DIR = $oldData
    $env:ORDERS_CONFIG_PATH = $oldConfig
    $env:ORDERS_ALLOWED_ORIGIN = $oldOrigin
    # Leave the tiny temporary directory available for diagnosing CI failures.
}
