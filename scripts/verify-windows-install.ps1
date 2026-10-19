$ErrorActionPreference = 'Stop'
$pkg = Get-Content -Raw package.json | ConvertFrom-Json
$setup = Join-Path (Resolve-Path release) "KI-Metadata-Workbench-$($pkg.version)-Windows-x64-Setup.exe"
$installDir = Join-Path $env:RUNNER_TEMP "KI Metadata Workbench Acceptance"
$evidence = Join-Path (Resolve-Path release) 'ci-evidence'
New-Item -ItemType Directory -Force -Path $evidence | Out-Null
if (Test-Path -LiteralPath $installDir) { throw 'Acceptance directory already exists.' }
$installer = Start-Process -FilePath $setup -ArgumentList "/S /D=$installDir" -Wait -PassThru
if ($installer.ExitCode -ne 0) { throw "Installer exited $($installer.ExitCode)" }
$exe = Join-Path $installDir 'KI Metadata Workbench.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw 'Installed app executable is missing.' }
$info = (Get-Item -LiteralPath $exe).VersionInfo
if ($info.ProductName -cne 'KI Metadata Workbench' -or -not $info.ProductVersion.StartsWith($pkg.version)) { throw 'Wrong installed product identity.' }
$records = @(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -ceq 'KI Metadata Workbench' -and $_.InstallLocation.TrimEnd('\') -eq $installDir.TrimEnd('\') })
if ($records.Count -ne 1) { throw 'Expected the per-user Array-compatible installation record.' }
$env:KI_PACKAGED_EXE = $exe
node tests/packaged.desktop.mjs
if ($LASTEXITCODE) { throw 'Installed desktop acceptance failed.' }
$uninstallers = @(Get-ChildItem -LiteralPath $installDir -File -Filter '*Uninstall*.exe')
if ($uninstallers.Count -ne 1) { throw 'Expected exactly one installed uninstaller.' }
$uninstall = Start-Process -FilePath $uninstallers[0].FullName -ArgumentList '/S' -Wait -PassThru
if ($uninstall.ExitCode -ne 0) { throw "Uninstaller exited $($uninstall.ExitCode)" }
for ($i = 0; $i -lt 60 -and (Test-Path -LiteralPath $exe); $i++) { Start-Sleep -Milliseconds 500 }
if (Test-Path -LiteralPath $exe) { throw 'Uninstall did not remove the application executable.' }
@{
  version = $pkg.version
  runner_os = $env:RUNNER_OS
  commit = $env:GITHUB_SHA
  installer_exit = $installer.ExitCode
  product_name = $info.ProductName
  product_version = $info.ProductVersion
  per_user_install_record = $true
  installed_desktop_checks = 'passed'
  uninstaller_exit = $uninstall.ExitCode
  application_removed = $true
  unsigned = $true
} | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $evidence 'windows-install-acceptance.json')
Write-Output 'Per-user install, native identity, packaged Electron workflow and uninstall passed.'
