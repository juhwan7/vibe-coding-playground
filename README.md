<div align="center">

# MARKET FLOW

### 한국·미국 시장의 자금 흐름과 테마 회전을 1초 안에 훑어보는 개인 Market Lab

[![CI](https://github.com/juhwan7/vibe-coding-playground/actions/workflows/ci.yml/badge.svg)](https://github.com/juhwan7/vibe-coding-playground/actions/workflows/ci.yml)
[![Raspberry Pi Deploy](https://github.com/juhwan7/vibe-coding-playground/actions/workflows/deploy-to-pi.yml/badge.svg)](https://github.com/juhwan7/vibe-coding-playground/actions/workflows/deploy-to-pi.yml)
![React](https://img.shields.io/badge/React-19-20232a?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Raspberry_Pi-2496ed?logo=docker&logoColor=white)

**거래대금 · 테마 평균 차트 · 시장 자금 · 특징주 뉴스 · 종목 퀴즈**

</div>

---

## 이 프로젝트는 무엇인가요?

`MARKET FLOW`는 단순 종목 시세표가 아니라 **시장에서 돈이 어디에 모이고 어디로 이동하는지 아주 짧은 시간에 확인하기 위해 만든 취미용 전광판**입니다.

한국 시장과 미국 시장의 거래대금 상위 종목을 가져오고, 같은 테마의 종목이 거래대금 상위권에 여러 개 등장하면 하나의 테마로 묶어 **전일 + 오늘 3분 평균 차트**로 비교합니다. 시장 해석 문구를 자동으로 붙이기보다 실제 값과 흐름을 그대로 보여주는 것을 우선합니다.

> 이 프로젝트의 `시장 거래대금` 표시는 전체 상장종목 거래대금 총합이 아니라 **거래대금 TOP100 랭킹의 합계/커버리지**입니다.

## 주요 화면

| 화면 | 무엇을 보는 곳인가요? |
| --- | --- |
| **증시 자금** | KOSPI·KOSDAQ, TOP100 누적 거래대금, 동시간 비교, 외국인·기관·개인, 프로그램 매매, 주변자금 |
| **국내 테마 흐름** | 국내 거래대금 TOP50에서 같은 테마 3종 이상을 묶고 전일+오늘 평균 차트 비교 |
| **미국 테마 흐름** | 미국 거래대금 상위 종목을 AI 반도체·빅테크·전력/원전·양자·전기차 등으로 묶어 회전 비교 |
| **특징주 이슈** | 거래대금 TOP50 종목과 겹치는 당일 특징주 기사를 실제 링크와 함께 표시 |
| **종목 퀴즈** | KOSPI 200 / KOSDAQ 150을 분리해 실제 기업 설명을 보고 회사를 맞히는 4지선다 |

### 테마 흐름 계산 방식

```text
거래대금 TOP100
        ↓
상위 50종목 확인
        ↓
같은 테마가 3종 이상인가?
        ↓ YES
테마별 거래대금 합계로 순위 결정
        ↓
각 구성종목 1분봉 저장 / 과거 데이터 복원
        ↓
3분 단위 수익률 평균 + 3분 거래대금
        ↓
전일 + 오늘 테마 평균 차트
```

테마 평균선은 구성종목별 기준시점 수익률을 정규화한 뒤 동일 가중 평균합니다. 차트 아래 거래대금 막대는 해당 테마 구성종목의 같은 구간 거래대금을 합산합니다.

---

## 1초 안에 보이게 만드는 구조

이 사이트에서는 **사용자 접속이 데이터 수집의 시작점이 아닙니다.** Raspberry Pi는 사용자가 아무도 없을 때도 데이터를 계속 수집하고 화면에 필요한 계산까지 끝낸 뒤 마지막 정상 결과를 준비합니다.

```text
Toss / 뉴스 / 시장 데이터
          ↓
Raspberry Pi 백그라운드 수집
          ↓
테마 계산 · TOP100 · 히스토리 정리
          ↓
완성된 JSON을 원자적으로 교체
          ↓
Nginx가 JSON 파일을 직접 제공
          ↓
사용자 접속
```

준비되는 핵심 파일은 다음과 같습니다.

```text
market-snapshot.json
market-history.json
kr-theme-flow.json
us-theme-flow.json
feature-news.json
```

새 수집이 실패하거나 진행 중이어도 기존 정상 파일을 지우지 않습니다. 새 결과가 완전히 준비됐을 때만 파일을 교체합니다. 따라서 방문자는 데이터 수집을 기다리지 않고 **마지막 정상 화면을 먼저 즉시 확인**할 수 있습니다.

브라우저에는 Service Worker 기반의 마지막 정상 API 응답 캐시도 둡니다. 재방문 때 Pi나 네트워크 응답이 잠시 느려도 이전 정상 화면부터 먼저 표시하고, 최신 응답은 뒤에서 갱신합니다.

---

## Raspberry Pi 최적화

이 프로젝트는 고성능 서버보다 **저전력 Raspberry Pi**에서 계속 켜두는 것을 전제로 합니다. 그래서 모든 요청을 매분 한꺼번에 실행하지 않습니다.

```text
우선순위 1  사용자가 처음 보는 국내 증시 핵심 데이터
            KOSPI / KOSDAQ / 국내 거래대금 TOP100
                         ↓
우선순위 2  국내 테마 흐름
                         ↓
우선순위 3  미국 테마 흐름 / 종목별 상세 데이터
```

현재 기본 수집 정책은 다음과 같습니다.

- 핵심 장중 데이터: **60초**
- 외국인·기관·프로그램 등 상대적으로 느린 데이터: **180초**
- 특징주 뉴스: **180초**
- 테마 차트: 장중 **60초**
- 준비된 화면용 JSON 확인/교체: 최대 **2초 단위**, 내용이 바뀐 경우에만 실제 디스크 기록
- 장 외 시간: 최대 **5분** 간격으로 완화
- Toss API 요청: 기본 **동시 2개 이하**, **2초 동안 최대 5개 요청 시작**
- 동일 API 요청이 동시에 겹치면 하나의 요청을 공유해 중복 호출 제거
- API `429` 발생 시 재시도 간격을 점점 늘리는 backoff 적용
- 서버 재시작 직후에는 마지막 정상 스냅샷을 먼저 표시하고 최신 데이터를 뒤에서 갱신
- 국내 첫 화면 → 국내 테마 → 미국 테마 순으로 초기화해 시작 순간의 API 폭주 방지

상단의 **`↻ 새로고침`** 버튼을 누르면 화면을 비우지 않습니다. 현재 숫자를 그대로 유지한 상태에서 핵심 시장 데이터를 최우선 큐로 갱신하고, 완료된 새 값만 교체합니다.

환경변수로 속도를 조절할 수도 있습니다.

```env
POLL_MS=60000
SLOW_POLL_MS=180000
FEATURE_NEWS_REFRESH_MS=180000
TOSS_MAX_CONCURRENT=2
TOSS_REQUEST_BATCH_SIZE=5
TOSS_REQUEST_WINDOW_MS=2000
KR_THEME_START_DELAY_MS=3000
US_THEME_START_DELAY_MS=8000
```

---

## 빠른 자동배포

프론트엔드는 더 이상 Raspberry Pi에서 React/TypeScript/Vite를 다시 컴파일하지 않습니다.

```text
GitHub-hosted CI
  ├─ TypeScript 검사
  ├─ 테스트
  ├─ npm run build
  └─ 검증된 dist artifact 생성
                ↓
Raspberry Pi runner
  ├─ dist 다운로드
  ├─ Nginx runtime image에 복사
  └─ Docker Compose 재기동
```

Pi는 정적 파일을 Nginx 이미지에 넣는 작업만 하므로, 프론트 수정마다 저전력 Pi에서 수분 동안 TypeScript/Vite 빌드를 반복하지 않습니다. 백엔드가 바뀌지 않았다면 백엔드 이미지도 재빌드하지 않습니다.

배포 성공 판정도 `최신 시장 데이터 수집 완료`를 기다리지 않습니다. **HTTP 서버와 마지막 정상 스냅샷이 즉시 제공되는지** 확인하면 배포는 완료되고, 새로운 시장 데이터 수집은 뒤에서 계속 진행됩니다.

---

## 시스템 구조

```text
                 ordinary ChatGPT
                       │
                       │ 코드 수정
                       ▼
                    GitHub
                       │
                 GitHub Actions CI
          ┌────────────┼────────────┐
          │            │            │
      TypeScript    Backend      Playwright
          │         Docker           │
          └────────────┴─────────────┘
                       │
              prebuilt frontend dist
                       │ CI 성공
                       ▼
          Raspberry Pi self-hosted runner
                       │
                 Docker Compose
               ┌───────┴────────┐
               │                │
             Nginx          Node backend
               │                │
               │          Toss / KRX / 뉴스
               │                │
               │       persistent market data
               │                │
               └──── shared prepared JSON
                       │
                 Cloudflare Tunnel
                       │
                     사용자
```

Raspberry Pi의 `.env`와 API 비밀키는 Git에 올라가지 않습니다. 공개 저장소의 PR 코드가 Pi self-hosted runner에서 직접 실행되지 않도록 실제 배포 workflow는 **성공한 `main` push의 검증된 commit만** 허용합니다.

---

## 데이터 소스

- **토스증권 Open API**: 국내/미국 시세, 거래대금 랭킹, 분봉, 국내 투자자/프로그램 관련 데이터
- **KRX Data Marketplace**: KOSPI 200 / KOSDAQ 150 구성종목
- **Npay 증권 기업개요 / FnGuide 표기 정보**: 종목 퀴즈의 기업 설명 캐시
- **Google News RSS**: 특징주 기사 탐색 및 원문 링크 연결
- **공공데이터 계열**: 투자자예탁금·CMA·신용융자·미수금 영역 연결 예정/부분 구현

데이터 소스가 응답하지 않는 경우 값을 임의 생성하지 않고 마지막 정상 캐시 또는 `-` 상태를 사용합니다.

### 미국 거래대금 랭킹 fallback

미국 시장 랭킹이 특정 방식에서 빈 응답을 반환할 수 있어 다음 순서로 확인합니다.

```text
1. MARKET_TRADING_AMOUNT · US · 1d
2. MARKET_TRADING_AMOUNT · US · realtime
3. TOSS_SECURITIES_TRADING_AMOUNT · US · 1d (대체 소스)
```

화면에는 어떤 랭킹 소스가 실제 사용됐는지 표시합니다.

---

## 종목 퀴즈

종목코드를 외우는 방식이 아니라 **기업 설명을 보고 종목을 맞히는 방식**입니다.

- `KOSPI 200`과 `KOSDAQ 150` 완전 분리
- KRX 실제 지수 구성종목 사용
- KOSPI는 최대 200개, KOSDAQ은 최대 150개
- 실제 구성종목 수가 기준보다 적다면 **가짜 종목으로 채우지 않고 실제 개수만 사용**
- ETF·ETN 등 상장지수상품 제외
- 기업 설명은 처음 필요할 때 가져온 뒤 Pi에 캐시하여 반복 호출 최소화

---

## 가장 쉬운 실행 방법 · Windows

1. 저장소를 ZIP으로 내려받아 압축을 풉니다.
2. Docker Desktop을 설치하고 실행합니다.
3. `START_WINDOWS.bat`을 더블클릭합니다.
4. 첫 실행에만 `TOSS_CLIENT_ID`, `TOSS_CLIENT_SECRET`을 입력합니다.
5. 입력값은 로컬 `.env`에만 저장되고 Git에는 올라가지 않습니다.
6. `http://localhost:8080`이 자동으로 열립니다.

토스증권 API가 `403`을 반환하면 토스증권 Open API 설정에서 **현재 Docker 서버의 공인 IP를 허용 IP로 등록**해야 합니다.

수동 실행:

```bash
docker compose up -d --build
```

종료:

```bash
docker compose down
```

---

## 개발 검증

```bash
npm install
npm run check
npm run test
node --test backend/*.test.mjs
npm run build
docker compose build
npm run test:e2e
```

GitHub Actions에서는 다음 검사를 병렬로 수행합니다.

- TypeScript type check
- 프론트 단위 테스트
- 백엔드 Node 테스트
- 백엔드 HTTP smoke test
- 프로덕션 빌드 + 배포용 `dist` artifact
- 백엔드 Docker build
- Nginx runtime frontend image build
- Playwright 데스크톱/모바일 브라우저 테스트

CI가 성공한 `main` commit만 Raspberry Pi 자동배포 대상으로 넘어갑니다.

---

## 보안 원칙

- `.env` / API secret / 토큰을 저장소에 커밋하지 않음
- API secret을 React 번들에 포함하지 않음
- 백엔드 포트는 외부에 직접 공개하지 않음
- 공개 PR 코드를 Raspberry Pi self-hosted runner에서 실행하지 않음
- 배포 workflow 권한은 가능한 작게 유지
- 유료 API나 서비스는 명시적 승인 없이 추가하지 않음

> 이 저장소는 공개 저장소이며 self-hosted runner는 Docker와 Pi 로컬 환경에 접근할 수 있습니다. 따라서 runner workflow의 실행 조건은 보안상 매우 중요합니다.

---

## 프로젝트 파일 안내

| 파일 | 역할 |
| --- | --- |
| `AGENTS.md` | AI 작업 행동 규칙 |
| `WORKFLOW.md` | ChatGPT → GitHub → Pi 작업 흐름 |
| `CHAT_CONTROL.md` | 일반 ChatGPT 채팅 중심 제어 방식 |
| `MEMORY.md` | 프로젝트 장기 결정사항 |
| `CHANGELOG.md` | 변경 기록 |
| `SURPRISE.md` | 자유 실험 규칙 |

---

<div align="center">

### 숫자는 크게, 해석은 최소로, 돈의 이동은 한 화면에.

이 프로젝트는 투자 권유 도구가 아니라 개인 시장 관찰용 프로젝트입니다.

</div>
