param(
  [Parameter(Position = 0)]
  [string]$Command = "init",

  [Parameter()]
  [ValidateRange(1, 10000)]
  [int]$Lines = 100
)

# 药大拾间 Windows 出站教务 Agent 部署脚本
#
# 用法：
#   .\deploy-agent.ps1 init       首次安装、构建并启动
#   .\deploy-agent.ps1 update     拉取代码、更新依赖、构建并重启
#   .\deploy-agent.ps1 start      启动 Agent
#   .\deploy-agent.ps1 stop       停止 Agent
#   .\deploy-agent.ps1 restart    重启 Agent
#   .\deploy-agent.ps1 logs       查看实时日志
#   .\deploy-agent.ps1 status     查看 PM2 状态
#   .\deploy-agent.ps1 autostart  开启当前用户登录自启动
#   .\deploy-agent.ps1 autostart-off    关闭登录自启动
#   .\deploy-agent.ps1 autostart-status 查看登录自启动状态
#
# 也可以直接使用 deploy-agent.cmd，避免 PowerShell 执行策略阻止脚本运行。

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ServerDir = Join-Path $RootDir "server"
$EnvFile = Join-Path $ServerDir ".env"
$AgentEntry = Join-Path $ServerDir "dist\jwxtAgent.js"
$AgentServiceName = "cpu-jwxt-agent"
$LegacyProxyServiceName = "cpu-jwxt-proxy"
$NodeMinMajor = 22
$AutostartRegistryPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$AutostartRegistryValueName = "CPUWebJwxtAgent"
$AutostartLogFile = Join-Path $ServerDir "logs\jwxt-agent-autostart.log"

function Write-DeployLog([string]$Message) {
  Write-Host "[deploy-agent] $Message" -ForegroundColor Green
}

function Write-DeployWarning([string]$Message) {
  Write-Warning "[deploy-agent] $Message"
}

function Fail([string]$Message) {
  throw "[deploy-agent] $Message"
}

function Get-AutostartCommand {
  $scriptPath = Join-Path $RootDir "deploy-agent.ps1"
  if ($scriptPath.Contains('"')) { Fail "脚本路径不能包含双引号：$scriptPath" }

  $powerShellExe = Get-Executable @("powershell.exe", "pwsh.exe", "powershell", "pwsh")
  if (-not $powerShellExe) { Fail "未找到可用于登录自启动的 PowerShell" }
  return "`"$powerShellExe`" -NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`" autostart-run"
}

function Get-AgentAutostartValue {
  if (-not (Test-Path -LiteralPath $AutostartRegistryPath)) { return "" }
  $item = Get-ItemProperty -LiteralPath $AutostartRegistryPath -Name $AutostartRegistryValueName -ErrorAction SilentlyContinue
  if ($null -eq $item) { return "" }
  return [string]$item.$AutostartRegistryValueName
}

function Write-AutostartLog([string]$Message) {
  $logDir = Split-Path -Parent $AutostartLogFile
  if (-not (Test-Path -LiteralPath $logDir)) {
    $null = New-Item -ItemType Directory -Path $logDir -Force
  }
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz"
  Add-Content -LiteralPath $AutostartLogFile -Encoding UTF8 -Value "[$timestamp] $Message"
}

function Get-Executable([string[]]$Names) {
  foreach ($name in $Names) {
    $commandInfo = Get-Command $name -ErrorAction SilentlyContinue
    if ($null -ne $commandInfo) { return $commandInfo.Source }
  }
  return $null
}

function Invoke-Native(
  [string]$FilePath,
  [string[]]$Arguments = @(),
  [switch]$AllowFailure,
  [switch]$Quiet
) {
  # Start-Process 让 npm / pm2 的 stdout 与 stderr 直接进入当前控制台，
  # 避免 Windows PowerShell 5 把原生命令的 stderr 误当成终止性 PowerShell 错误。
  $stdoutFile = ""
  $stderrFile = ""
  $startOptions = @{
    FilePath = $FilePath
    ArgumentList = $Arguments
    NoNewWindow = $true
    Wait = $true
    PassThru = $true
  }
  if ($Quiet) {
    $tempPrefix = Join-Path ([IO.Path]::GetTempPath()) "cpu-web-agent-$([Guid]::NewGuid().ToString('N'))"
    $stdoutFile = "$tempPrefix.stdout.log"
    $stderrFile = "$tempPrefix.stderr.log"
    $startOptions.RedirectStandardOutput = $stdoutFile
    $startOptions.RedirectStandardError = $stderrFile
  }

  try {
    $process = Start-Process @startOptions
    $exitCode = $process.ExitCode
  } finally {
    foreach ($tempFile in @($stdoutFile, $stderrFile)) {
      if ($tempFile -and (Test-Path -LiteralPath $tempFile)) {
        Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
      }
    }
  }
  if ($exitCode -ne 0 -and -not $AllowFailure) {
    Fail "命令执行失败（exit $exitCode）：$FilePath $($Arguments -join ' ')"
  }
  return $exitCode
}

function Refresh-ProcessPath {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $extraPaths = @(
    (Join-Path $env:APPDATA "npm"),
    (Join-Path $env:ProgramFiles "nodejs")
  )
  $env:Path = (@($machinePath, $userPath) + $extraPaths | Where-Object { $_ }) -join ";"
}

function Install-NodeLts {
  $winget = Get-Executable @("winget.exe", "winget")
  if (-not $winget) {
    Fail "未找到 Node.js $NodeMinMajor+，且系统没有 winget。请先安装 Node.js LTS：https://nodejs.org/"
  }
  Write-DeployLog "正在通过 winget 安装或升级 Node.js LTS"
  $code = Invoke-Native $winget @(
    "install", "--exact", "--id", "OpenJS.NodeJS.LTS", "--silent",
    "--accept-package-agreements", "--accept-source-agreements"
  ) -AllowFailure
  if ($code -ne 0) {
    $code = Invoke-Native $winget @(
      "upgrade", "--exact", "--id", "OpenJS.NodeJS.LTS", "--silent",
      "--accept-package-agreements", "--accept-source-agreements"
    ) -AllowFailure
  }
  Refresh-ProcessPath
}

function Ensure-Node {
  $node = Get-Executable @("node.exe", "node")
  if (-not $node) {
    Install-NodeLts
    $node = Get-Executable @("node.exe", "node")
  }
  if (-not $node) { Fail "Node.js 安装后仍不可用，请重新打开终端再运行脚本" }

  $versionText = (& $node --version).Trim()
  if ($LASTEXITCODE -ne 0 -or $versionText -notmatch '^v(?<major>\d+)\.') {
    Fail "无法识别 Node.js 版本：$versionText"
  }
  $major = [int]$Matches.major
  if ($major -lt $NodeMinMajor) {
    Write-DeployWarning "检测到 Node.js $versionText，本项目要求 Node.js $NodeMinMajor+"
    Install-NodeLts
    $node = Get-Executable @("node.exe", "node")
    $versionText = (& $node --version).Trim()
    if ($versionText -notmatch '^v(?<major>\d+)\.' -or [int]$Matches.major -lt $NodeMinMajor) {
      Fail "Node.js 仍低于 $NodeMinMajor，请手动升级并重新打开终端"
    }
  }
  Write-DeployLog "Node.js $versionText"
}

function Ensure-Pm2 {
  $pm2 = Get-Executable @("pm2.cmd", "pm2")
  if (-not $pm2) {
    $npm = Get-Executable @("npm.cmd", "npm")
    if (-not $npm) { Fail "未找到 npm，请重新安装 Node.js LTS" }
    Write-DeployLog "PM2 未安装，正在全局安装"
    $null = Invoke-Native $npm @("install", "--global", "pm2", "--no-audit", "--no-fund")
    Refresh-ProcessPath
    $pm2 = Get-Executable @("pm2.cmd", "pm2")
  }
  if (-not $pm2) { Fail "PM2 安装后仍不可用，请重新打开终端再运行脚本" }
  return $pm2
}

function Get-DotEnvValue([string]$Key) {
  if (-not (Test-Path -LiteralPath $EnvFile)) { return "" }
  $pattern = "^$([Regex]::Escape($Key))="
  $line = Get-Content -LiteralPath $EnvFile -Encoding UTF8 |
    Where-Object { $_ -match $pattern } |
    Select-Object -Last 1
  if ($null -eq $line) { return "" }
  $value = $line.Substring($line.IndexOf("=") + 1).Trim()
  if ($value.Length -ge 2) {
    $first = $value[0]
    $last = $value[$value.Length - 1]
    if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
      $value = $value.Substring(1, $value.Length - 2)
    }
  }
  return $value
}

function Set-DotEnvValue([string]$Key, [string]$Value) {
  if ($Value -match "[\r\n]") { Fail "$Key 不能包含换行符" }
  $escaped = $Value.Replace("\", "\\").Replace('"', '\"')
  $replacement = "$Key=`"$escaped`""
  $pattern = "^$([Regex]::Escape($Key))="
  $lines = if (Test-Path -LiteralPath $EnvFile) {
    @(Get-Content -LiteralPath $EnvFile -Encoding UTF8)
  } else {
    @()
  }
  $updated = $false
  for ($index = 0; $index -lt $lines.Count; $index++) {
    if ($lines[$index] -match $pattern) {
      $lines[$index] = $replacement
      $updated = $true
    }
  }
  if (-not $updated) { $lines += $replacement }
  [IO.File]::WriteAllLines($EnvFile, [string[]]$lines, [Text.UTF8Encoding]::new($false))
}

function Get-AgentEnvValue([string]$Suffix) {
  $value = Get-DotEnvValue "JWXT_AGENT_$Suffix"
  if ($value) { return $value }
  return Get-DotEnvValue "LOGIN_AGENT_$Suffix"
}

function New-RandomHex([int]$ByteCount) {
  $bytes = New-Object byte[] $ByteCount
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  return ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
}

function Ensure-AgentEnv {
  if (-not (Test-Path -LiteralPath $EnvFile)) {
    Fail "缺少 server\.env，请先从管理后台复制 Agent 配置到该文件"
  }
  $serverUrl = Get-AgentEnvValue "SERVER"
  $agentId = Get-AgentEnvValue "ID"
  $token = Get-AgentEnvValue "TOKEN"

  $uri = $null
  $validUri = [Uri]::TryCreate($serverUrl, [UriKind]::Absolute, [ref]$uri)
  if (-not $validUri -or $uri.Scheme -notin @("ws", "wss") -or $uri.UserInfo -or $uri.Fragment) {
    Fail "JWXT_AGENT_SERVER 必须是有效且不含账号、密码和 fragment 的 ws:// 或 wss:// 地址"
  }
  if ($agentId -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$') {
    Fail "JWXT_AGENT_ID 格式无效"
  }
  if ($token.Length -lt 32 -or $token.Length -gt 512) {
    Fail "JWXT_AGENT_TOKEN 长度必须在 32 到 512 个字符之间"
  }

  if ((Get-DotEnvValue "JWT_SECRET").Length -lt 32) {
    Set-DotEnvValue "JWT_SECRET" (New-RandomHex 32)
    Write-DeployLog "已生成 Agent 本机 JWT_SECRET"
  }
  if ((Get-DotEnvValue "JWXT_SESSION_SYNC_KEY").Length -lt 32) {
    Set-DotEnvValue "JWXT_SESSION_SYNC_KEY" (New-RandomHex 32)
    Write-DeployLog "已生成 Agent 本机会话加密密钥"
  }
  if (-not (Get-DotEnvValue "JWXT_AGENT_KEY_FILE")) {
    Set-DotEnvValue "JWXT_AGENT_KEY_FILE" ".jwxt-agent-identity.json"
  }
  if (-not (Get-DotEnvValue "NODE_ENV")) { Set-DotEnvValue "NODE_ENV" "production" }
  if (-not (Get-DotEnvValue "REDIS_ENABLED")) { Set-DotEnvValue "REDIS_ENABLED" "false" }
  Write-DeployLog "Agent 环境配置检查通过：$agentId -> $serverUrl"
}

function Protect-AgentIdentityFile {
  $configured = Get-DotEnvValue "JWXT_AGENT_KEY_FILE"
  if (-not $configured) { $configured = ".jwxt-agent-identity.json" }
  $identityPath = if ([IO.Path]::IsPathRooted($configured)) { $configured } else { Join-Path $ServerDir $configured }
  for ($attempt = 0; $attempt -lt 20 -and -not (Test-Path -LiteralPath $identityPath); $attempt++) {
    Start-Sleep -Milliseconds 100
  }
  if (-not (Test-Path -LiteralPath $identityPath)) {
    Write-DeployWarning "Agent 加密身份文件尚未生成；请在首次连接后确认 $identityPath 仅运行账户可读"
    return
  }
  $icacls = Get-Executable @("icacls.exe", "icacls")
  if ($icacls) {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $code = Invoke-Native $icacls @($identityPath, "/inheritance:r", "/grant:r", "${currentUser}:(F)", "*S-1-5-18:(F)", "*S-1-5-32-544:(F)") -AllowFailure
    if ($code -ne 0) { Write-DeployWarning "无法自动收紧 Agent 身份文件 ACL：$identityPath" }
  }
}

function Test-Pm2Process([string]$ServiceName) {
  $pm2 = Ensure-Pm2
  $exitCode = Invoke-Native $pm2 @("describe", $ServiceName) -AllowFailure -Quiet
  return $exitCode -eq 0
}

function Install-AgentDependencies {
  $npm = Get-Executable @("npm.cmd", "npm")
  if (-not $npm) { Fail "未找到 npm" }
  Write-DeployLog "安装 Agent 后端依赖"
  $null = Invoke-Native $npm @("install", "--prefix", "server", "--no-audit", "--no-fund")
}

function Build-Agent {
  $npm = Get-Executable @("npm.cmd", "npm")
  Write-DeployLog "构建 server\dist\jwxtAgent.js"
  $null = Invoke-Native $npm @("run", "build", "--prefix", "server")
  if (-not (Test-Path -LiteralPath $AgentEntry)) { Fail "构建完成后未找到 $AgentEntry" }
}

function Pull-LatestCode {
  if (-not (Test-Path -LiteralPath (Join-Path $RootDir ".git"))) {
    Write-DeployWarning "当前目录不是 Git 仓库，跳过 git pull"
    return
  }
  $git = Get-Executable @("git.exe", "git")
  if (-not $git) {
    Write-DeployWarning "未安装 Git，跳过 git pull，继续部署当前代码"
    return
  }
  Write-DeployLog "拉取最新代码"
  $code = Invoke-Native $git @("pull", "--ff-only") -AllowFailure
  if ($code -ne 0) { Write-DeployWarning "git pull 失败，继续部署当前代码" }
}

function Start-Agent([switch]$SuppressAutostartHint) {
  Ensure-Node
  $pm2 = Ensure-Pm2
  Ensure-AgentEnv
  if (-not (Test-Path -LiteralPath $AgentEntry)) {
    Fail "缺少 server\dist\jwxtAgent.js，请先运行 .\deploy-agent.cmd init 或 update"
  }

  if (Test-Pm2Process $AgentServiceName) {
    Write-DeployLog "重启 $AgentServiceName"
    $null = Invoke-Native $pm2 @("restart", $AgentServiceName, "--update-env")
  } else {
    Write-DeployLog "启动 $AgentServiceName"
    Push-Location $ServerDir
    try {
      $null = Invoke-Native $pm2 @(
        "start", "dist/jwxtAgent.js",
        "--name", $AgentServiceName,
        "--interpreter", "node",
        "--time",
        "--max-memory-restart", "600M",
        "--merge-logs"
      )
    } finally {
      Pop-Location
    }
  }
  $null = Invoke-Native $pm2 @("save")
  Protect-AgentIdentityFile

  if (Test-Pm2Process $LegacyProxyServiceName) {
    Write-DeployLog "移除已由出站 Agent 取代的旧代理 $LegacyProxyServiceName"
    $null = Invoke-Native $pm2 @("delete", $LegacyProxyServiceName)
    $null = Invoke-Native $pm2 @("save")
  }
  Write-DeployLog "Agent 已启动。使用 .\deploy-agent.cmd logs 查看连接日志"
  if (-not $SuppressAutostartHint -and -not (Get-AgentAutostartValue)) {
    Write-Host "可运行 .\deploy-agent.cmd autostart 开启当前用户登录后的自动启动。"
  }
}

function Stop-Agent([switch]$IgnoreMissing) {
  $pm2 = Ensure-Pm2
  if (-not (Test-Pm2Process $AgentServiceName)) {
    if (-not $IgnoreMissing) { Write-DeployWarning "$AgentServiceName 尚未注册" }
    return
  }
  Write-DeployLog "停止 $AgentServiceName"
  $null = Invoke-Native $pm2 @("stop", $AgentServiceName)
}

function Restart-Agent {
  Ensure-Node
  $pm2 = Ensure-Pm2
  Ensure-AgentEnv
  if (-not (Test-Pm2Process $AgentServiceName)) {
    Start-Agent
    return
  }
  $null = Invoke-Native $pm2 @("restart", $AgentServiceName, "--update-env")
  $null = Invoke-Native $pm2 @("save")
  Write-DeployLog "Agent 已重启"
}

function Deploy-Agent([switch]$Pull) {
  Ensure-Node
  $null = Ensure-Pm2
  Ensure-AgentEnv
  if ($Pull) { Pull-LatestCode }

  $wasRegistered = Test-Pm2Process $AgentServiceName
  if ($wasRegistered) {
    # Windows 下运行中的 Prisma DLL 可能阻止 prisma generate 覆盖文件。
    Stop-Agent -IgnoreMissing
  }
  try {
    Install-AgentDependencies
    Build-Agent
    Start-Agent
  } catch {
    if ($wasRegistered -and (Test-Path -LiteralPath $AgentEntry)) {
      Write-DeployWarning "更新失败，尝试恢复原 Agent 进程"
      try { Start-Agent } catch { Write-DeployWarning "旧 Agent 恢复失败，请手动检查 PM2 日志" }
    }
    throw
  }
}

function Show-Status {
  $pm2 = Ensure-Pm2
  $null = Invoke-Native $pm2 @("status")
  if (Test-Pm2Process $AgentServiceName) {
    $null = Invoke-Native $pm2 @("describe", $AgentServiceName)
  }
  Show-AgentAutostartStatus
}

function Show-Logs {
  $pm2 = Ensure-Pm2
  if (-not (Test-Pm2Process $AgentServiceName)) { Fail "$AgentServiceName 尚未注册" }
  $null = Invoke-Native $pm2 @("logs", $AgentServiceName, "--lines", [string]$Lines)
}

function Enable-AgentAutostart {
  Start-Agent -SuppressAutostartHint

  $commandLine = Get-AutostartCommand
  if (-not (Test-Path -LiteralPath $AutostartRegistryPath)) {
    $null = New-Item -Path $AutostartRegistryPath -Force
  }
  $null = New-ItemProperty `
    -LiteralPath $AutostartRegistryPath `
    -Name $AutostartRegistryValueName `
    -Value $commandLine `
    -PropertyType String `
    -Force

  $savedValue = Get-AgentAutostartValue
  if ($savedValue -ne $commandLine) {
    Fail "Windows 自启动项写入后校验失败"
  }
  Write-DeployLog "已开启当前 Windows 用户登录后的 Agent 自动启动"
  Write-Host "启动项：$AutostartRegistryValueName"
  Write-Host "失败日志：$AutostartLogFile"
}

function Disable-AgentAutostart {
  if (Get-AgentAutostartValue) {
    Remove-ItemProperty `
      -LiteralPath $AutostartRegistryPath `
      -Name $AutostartRegistryValueName `
      -Force
    if (Get-AgentAutostartValue) {
      Fail "Windows 自启动项删除后校验失败"
    }
    Write-DeployLog "已关闭当前 Windows 用户的 Agent 登录自启动"
  } else {
    Write-DeployLog "Agent 登录自启动原本就是关闭状态"
  }
}

function Show-AgentAutostartStatus {
  $currentValue = Get-AgentAutostartValue
  if (-not $currentValue) {
    Write-Host "Agent 登录自启动：未开启"
    return
  }

  $expectedValue = Get-AutostartCommand
  if ($currentValue -eq $expectedValue) {
    Write-Host "Agent 登录自启动：已开启"
  } else {
    Write-DeployWarning "Agent 登录自启动已注册，但脚本路径或参数已经变化；请重新运行 autostart 更新启动项"
  }
  Write-Host "启动命令：$currentValue"
}

function Start-AgentFromAutostart {
  try {
    Start-Agent
    Write-AutostartLog "Agent 登录自启动成功"
  } catch {
    Write-AutostartLog "Agent 登录自启动失败：$($_.Exception.Message)"
    throw
  }
}

function Show-Help {
  @"
Windows 出站教务 Agent 部署脚本

  .\deploy-agent.cmd init             首次安装、构建并启动
  .\deploy-agent.cmd update           git pull、更新依赖、构建并重启
  .\deploy-agent.cmd start            启动（已存在时重启并刷新环境变量）
  .\deploy-agent.cmd stop             停止
  .\deploy-agent.cmd restart          重启并刷新环境变量
  .\deploy-agent.cmd logs [-Lines 200] 查看日志
  .\deploy-agent.cmd status           查看状态
  .\deploy-agent.cmd autostart        开启当前用户登录后的自动启动
  .\deploy-agent.cmd autostart-off    关闭登录自启动
  .\deploy-agent.cmd autostart-status 查看登录自启动状态

运行前请把管理后台生成的完整配置写入 server\.env。
脚本同时接受 agent-init、agent-update 等 Linux 同名命令。
"@ | Write-Host
}

function Invoke-DeployAgentCommand {
  Set-Location $RootDir
  $normalizedCommand = $Command.Trim().ToLowerInvariant()
  switch ($normalizedCommand) {
    { $_ -in @("init", "agent-init") } { Deploy-Agent; break }
    { $_ -in @("update", "agent-update") } { Deploy-Agent -Pull; break }
    { $_ -in @("start", "agent-start") } { Start-Agent; break }
    { $_ -in @("stop", "agent-stop") } { Stop-Agent; break }
    { $_ -in @("restart", "agent-restart") } { Restart-Agent; break }
    { $_ -in @("logs", "agent-logs") } { Show-Logs; break }
    { $_ -in @("status", "agent-status") } { Show-Status; break }
    { $_ -in @("autostart", "enable-autostart") } { Enable-AgentAutostart; break }
    { $_ -in @("autostart-off", "disable-autostart") } { Disable-AgentAutostart; break }
    { $_ -in @("autostart-status") } { Show-AgentAutostartStatus; break }
    { $_ -in @("autostart-run") } { Start-AgentFromAutostart; break }
    { $_ -in @("help", "-h", "--help", "/?") } { Show-Help; break }
    default { Fail "未知命令：$Command。运行 .\deploy-agent.cmd help 查看用法" }
  }
}

if ($MyInvocation.InvocationName -ne ".") {
  Invoke-DeployAgentCommand
}
