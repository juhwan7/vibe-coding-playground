# PROJECT STATUS

마지막 갱신: 2026-09-09 (KST)

이 문서는 새 Chat/Codex 세션이 `juhwan7/vibe-coding-playground`의 현재 상태를 복원하기 위한 진입점입니다. 새 세션에서는 이 파일을 먼저 읽고, `CHANGELOG.md`, `MEMORY.md`, 열린 PR, 최근 main 커밋, GitHub Actions, `tunnel-status` 브랜치의 상태 파일을 이어서 확인합니다.

## 1. 프로젝트 목표

한국 주식시장의 장중 자금 흐름을 한 화면에서 읽는 개인용 Market Intelligence 대시보드입니다. 단순 시세가 아니라 거래대금, 테마 회전, 외국인·기관·프로그램 수급, 데이터 신뢰도, 뉴스 근거와 시간 흐름을 함께 보고 시장 상태를 빠르게 이해하는 것이 목적입니다.

원칙은 다음과 같습니다.

- 확인되지 않은 원인을 사실처럼 만들지 않습니다.
- 실제 공급원 데이터가 없으면 `-`, `MISSING`, `실데이터 미연결`처럼 명시합니다.
- 뉴스와 주가의 시간적 선후는 보여주되 인과관계로 단정하지 않습니다.
- 페이지 조회가 무거운 데이터 수집을 트리거하지 않도록 Pi가 prepared snapshot을 미리 만듭니다.

## 2. 현재 릴리스

- 릴리스: `0.6.0 Market Intelligence`
- 기준 브랜치: `main`
- 실제 Pi 배포 커밋은 `tunnel-status/RUNTIME_STATUS.md`의 `App deployed commit`을 기준으로 확인합니다.
- 공개 주소 레지스트리는 `tunnel-status/CURRENT_TUNNEL.md`입니다.
- 앱 로컬 헬스와 외부 터널 헬스는 `tunnel-status/RUNTIME_STATUS.md`에서 분리 확인합니다.
- Quick Tunnel URL은 영구 주소가 아니므로 이 문서에 고정하지 않습니다.

## 3. 현재 아키텍처

```text
Toss/Open data/News/Optional Futures Provider
  → Raspberry Pi Node backend
  → live market snapshot / history
  → theme candidate engine
  → Market Intelligence engine
  → prepared JSON
  → Nginx direct serving
  → React dashboard
  → Cloudflare Quick Tunnel
```

백엔드는 마지막 정상 스냅샷과 장중 히스토리를 영속 저장합니다. Nginx는 다음 prepared JSON을 직접 제공합니다.

- `market-snapshot.json`
- `market-history.json`
- `kr-theme-flow.json`
- `market-intelligence.json`
- `us-theme-flow.json`
- `feature-news.json`

준비 파일이 없을 때만 Node API로 fallback합니다.

## 4. 국내 테마 엔진

원시 테마 서비스는 내부 challenger 확보를 위해 최대 5개 후보를 계산합니다. 사용자 화면의 최종 테마는 Market Intelligence가 최대 4개로 안정화합니다.

### 교체 규칙

- 화면 테마: 4개
- 신규 후보가 기존 약한 테마보다 기본 8% 이상 강하거나
- 3회 연속 우위를 확인해야 교체
- 작은 순위 차이로 카드가 계속 깜빡이는 현상을 방지

환경변수:

- `THEME_REPLACEMENT_MARGIN=0.08`
- `THEME_REPLACEMENT_CONFIRMATIONS=3`

### 테마 강도 해석 지표

각 테마에 다음 값을 계산합니다.

- 누적 거래대금
- 중복조정 거래대금: 여러 테마에 속한 종목은 1/N 배분
- 상승 확산도
- 구성종목 중앙값 수익률
- 대장주 거래대금 집중도
- 10분 환산 자금 유입 속도
- 최근 1시간/3시간 변화
- 종합 강도점수

### 생애주기

원시값 기반으로 다음 상태를 표시합니다.

`출현 → 확산 → 주도 → 과열 → 둔화 → 이탈`

조건이 어느 단계에도 강하게 해당하지 않으면 `유지`로 표시합니다.

## 5. 테마 카탈로그

국내 테마 매핑은 코드에 직접 박아두지 않고 `backend/data/themes.kr.json`에서 관리합니다.

현재 포함 카테고리:

- 반도체
- 원전
- 전력기기
- 방산
- 조선
- 2차전지
- 바이오
- 인터넷·게임
- 자동차
- 금융
- 로봇

AI 자동 추정 후보를 곧바로 실제 집계에 넣지 않고 검토된 코드·키워드 목록만 사용하는 것이 기본 정책입니다.

## 6. 데이터 신뢰도와 품질 감시

Market Intelligence는 시장/테마/뉴스/선물에 대해 다음 신선도 상태를 제공합니다.

- `LIVE`
- `DELAYED`
- `STALE`
- `FALLBACK`
- `MISSING`

현재 자동 감지 항목:

- 시장 스냅샷 지연/정지
- 테마 원천 데이터 지연
- TOP100 표본이 비정상적으로 적음
- 상위 종목 등락률이 지나치게 동일함
- 당일 누적 거래대금이 이전 값보다 비정상적으로 감소

오류가 생겨도 last-known-good 화면은 유지하되 신뢰도 상태를 별도 표시합니다.

## 7. 시장 상태 엔진

규칙 기반으로 다음 데이터를 조합해 현재 시장 상태를 설명합니다.

- 상승 종목 비율
- 상승 종목 거래대금 비중
- TOP10 거래대금 집중도
- 외국인 현물 순매수
- 기관 현물 순매수
- 차익/비차익 프로그램
- 확산형 주도테마 수

화면에서는 `위험선호 우위`, `방어적 장세`, `상승 거래대금 우위`, `하락 거래대금 우위`, `중립 장세` 등으로 표시하며, 판정 근거 원시값도 함께 보여줍니다.

## 8. 수급 흐름

Market Intelligence 패널에서 장중 히스토리를 이용해 다음 4개 흐름을 sparkline으로 표시합니다.

- 외국인 현물
- 기관 현물
- 비차익 프로그램
- 차익 프로그램

현재값 하나보다 방향과 가속을 읽을 수 있게 하는 목적입니다.

## 9. 뉴스 근거 등급과 이벤트 타임라인

뉴스는 A/B/C로 근거 수준을 구분합니다.

- `A`: DART/KRX/금융감독원/공시 등 1차자료로 확인된 경우
- `B`: 복수 출처에서 같은 이슈가 확인된 경우
- `C`: 단일 기사 또는 아직 1차자료 확인이 안 된 경우

`/api/market/event-timeline`은 종목별 3분 가격 흐름과 매칭된 뉴스 시간을 합쳐 반환합니다. 현재 화면에서는 주도테마 대장주를 우선 표시합니다. 뉴스 직후 가격 반응을 볼 수 있지만 인과관계로 단정하지 않습니다.

## 10. 장중 복기와 종가판

`/api/market/replay`는 저장된 시장 히스토리에서 최근 장중 상태를 복원합니다. 기본 화면은 최근 2거래일, 5분 해상도 슬라이더를 제공합니다.

매 거래일 다음 두 스냅샷을 별도로 영속 저장합니다.

- `15:20 PRE_CLOSE`
- `15:35 FINAL`

Close Archive는 기본 35거래일 보관합니다. 이를 통해 15:20 당시 강했던 테마/종목이 종가까지 유지됐는지 비교할 수 있습니다.

## 11. 선물 데이터

프론트와 백엔드는 KOSPI200 선물 데이터를 받을 구조를 갖췄습니다. 다만 현재 검증된 실제 선물 공급원 URL/권한이 없으면 값을 표시하지 않습니다.

선택 환경변수:

- `FUTURES_SNAPSHOT_URL`
- `FUTURES_SNAPSHOT_TOKEN`
- `FUTURES_REFRESH_MS`

공급원이 없을 때는 `available=false`, `실데이터 미연결`로 표시합니다. 가짜 값이나 추정 계약수를 생성하지 않습니다.

## 12. API 운영 보호

공개 `POST /api/market/refresh`에는 기본 20초 서버 쿨다운을 적용합니다.

- `MANUAL_REFRESH_COOLDOWN_MS=20000`
- 쿨다운 중에는 HTTP 429와 `retryAfterSeconds` 반환
- 동시에 진행 중인 실제 refresh는 기존 Promise를 공유

CORS는 기본 wildcard를 사용하지 않습니다. 다른 Origin 허용이 정말 필요한 경우에만 `MARKET_ALLOWED_ORIGIN`을 설정합니다.

## 13. 주요 API

기존 API와 함께 다음 엔드포인트가 추가되었습니다.

- `/api/market/intelligence`
- `/api/market/event-timeline?symbol=000000`
- `/api/market/replay`
- `/api/market/close-archive`
- `/api/market/futures`

## 14. CI/CD

CI 검증 항목:

- TypeScript type check
- Vitest
- Node backend tests
- backend HTTP smoke
- production Vite build
- runtime frontend MIME smoke
- backend Docker build
- Playwright browser tests

`package-lock.json`을 저장소에 유지하고 CI 설치는 `npm ci`를 사용합니다.

배포 흐름:

```text
작업 브랜치
  → PR
  → CI
  → main 병합
  → main CI 성공
  → Deploy to Raspberry Pi
  → 검증된 frontend-dist 사용
  → exact verified SHA checkout
  → Docker 갱신
  → local health/snapshot/MIME 검증
  → Quick Tunnel status + Runtime status 게시
```

## 15. 터널과 런타임 상태

두 파일의 역할을 구분합니다.

### `CURRENT_TUNNEL.md`

- 현재 Quick Tunnel URL
- URL/status가 바뀐 시각
- tunnel service scope/system 상태

### `RUNTIME_STATUS.md`

- 최근 독립 헬스체크 시각
- Pi 로컬 앱 상태
- Pi 저장소의 실제 배포 커밋
- 외부 터널 도달 가능 여부
- CURRENT_TUNNEL 레지스트리 갱신시각
- 현재 터널 URL first-seen 시각과 age

즉 앱 자체가 정상인데 터널만 끊긴 경우를 명확히 분리할 수 있습니다.

## 16. 다음 세션 시작 순서

새 Chat/Codex에서 다음 순서로 확인합니다.

1. `PROJECT_STATUS.md`
2. `CHANGELOG.md`
3. 열린 PR과 최근 main 커밋
4. 최근 GitHub Actions
5. `tunnel-status/CURRENT_TUNNEL.md`
6. `tunnel-status/RUNTIME_STATUS.md`
7. 사용자 신규 요청

이미 완료된 기능을 처음부터 다시 만들지 않습니다. 새 변경은 기존 prepared-snapshot/Pi 자원 절약 구조와 데이터 비조작 원칙을 유지해야 합니다.
