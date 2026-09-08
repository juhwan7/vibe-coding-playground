$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host 'Docker Desktop이 설치되어 있지 않거나 docker 명령을 찾을 수 없습니다.' -ForegroundColor Red
  Write-Host 'Docker Desktop을 설치하고 다시 실행하세요.'
  Read-Host 'Enter를 누르면 종료합니다'
  exit 1
}

if (-not (Test-Path '.env')) {
  Write-Host '첫 실행입니다. 토스증권 Open API 값을 이 PC에만 저장합니다.' -ForegroundColor Cyan
  Write-Host '입력값은 GitHub에 업로드되지 않습니다.'
  $clientId = Read-Host 'TOSS_CLIENT_ID'
  $secureSecret = Read-Host 'TOSS_CLIENT_SECRET' -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
  try { $clientSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }

  @(
    "TOSS_CLIENT_ID=$clientId"
    "TOSS_CLIENT_SECRET=$clientSecret"
    'POLL_MS=5000'
    'SLOW_POLL_MS=60000'
  ) | Set-Content -Path '.env' -Encoding UTF8
  Write-Host '.env 생성 완료' -ForegroundColor Green
}

Write-Host '프론트엔드 + 백엔드 Docker를 빌드/실행합니다...' -ForegroundColor Cyan
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { throw 'docker compose 실행에 실패했습니다.' }

Write-Host '실행 완료: http://localhost:8080' -ForegroundColor Green
Start-Sleep -Seconds 2
Start-Process 'http://localhost:8080'
Write-Host '화면에 허용 IP 오류가 나오면 토스증권 WTS > 설정 > Open API > 허용 IP에 현재 공인 IP를 등록하세요.' -ForegroundColor Yellow
Read-Host 'Enter를 누르면 창을 닫습니다'
