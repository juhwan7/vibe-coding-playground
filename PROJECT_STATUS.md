# PROJECT STATUS

마지막 갱신: 2026-09-09 (KST)

이 문서는 새 Chat/Codex 세션이 `juhwan7/vibe-coding-playground`의 현재 상태를 빠르게 복원하기 위한 **최우선 진입 문서**입니다. 새 세션에서는 이 파일 → `CHANGELOG.md` → `MEMORY.md` → 최근 `main`/열린 PR → GitHub Actions → `tunnel-status` 상태 파일 순서로 확인합니다.

## 1. 프로젝트 목표

한국 주식시장의 장중 자금 흐름을 한 화면에서 읽는 개인용 Market Intelligence 대시보드입니다. 단순 시세가 아니라 거래대금, 테마 회전, 외국인·기관·프로그램 수급, 뉴스 촉매, 데이터 신뢰도와 시간 흐름을 함께 보고 시장 상태를 빠르게 이해하는 것이 목적입니다.

고정 원칙:

- 확인되지 않은 원인을 사실처럼 만들지 않음
- 실제 공급원 값이 없으면 `-`, `MISSING`, `실데이터 미연결` 표시
- 차트 시각화는 확대할 수 있지만 실제 % 값을 변형하지 않음
- 뉴스와 가격의 시간적 선후를 보여줘도 인과관계로 단정하지 않음
- 페이지 조회가 무거운 데이터 수집을 직접 트리거하지 않도록 Pi가 prepared snapshot을 미리 생성
- ETF/ETN 등 비개별주는 국내 테마/거래대금 개별주 화면에서 제외

## 2. 현재 릴리스

- 릴리스 기준: `0.6.1`
- 목표 브랜치: `main`
- 실제 Pi 배포 커밋: `tunnel-status/RUNTIME_STATUS.md`의 `App deployed commit` 확인
- 현재 공개 주소: `tunnel-status/CURRENT_TUNNEL.md` 확인
- README에는 마지막 확인 시점의 실제 Quick Tunnel URL도 표시하지만 Quick Tunnel은 회전 가능

## 3. 현재 아키텍처

```text
Toss / News / Open data / Optional Futures Provider
  → Raspberry Pi Node backend
  → live market snapshot / 1m history / candle cache
  → 5-theme candidate engine
  → 3m trading-amount-weighted theme series
  → Market Intelligence engine
  → prepared JSON
  → Nginx direct serving
  → React dashboard
  → Cloudflare Quick Tunnel
```

prepared JSON:

- `market-snapshot.json`
- `market-history.json`
- `kr-theme-flow.json`
- `market-intelligence.json`
- `us-theme-flow.json`
- `feature-news.json`

prepared 파일이 없을 때만 Node API로 fallback합니다. 새로운 수집이 실패해도 last-known-good 화면을 우선 유지합니다.

## 4. 국내 테마 엔진

### 사용자 화면 테마 수

**항상 최대 5개**가 최종 목표입니다. 0.6.0에서 원시 후보 5개/최종 화면 4개로 나뉘었던 구조를 0.6.1에서 Market Intelligence까지 5개로 통일했습니다.

선정 우선순위:

1. TOP50 안에서 같은 테마 개별주 3종 이상
2. 부족하면 TOP50 2종 이상
3. 그래도 부족하면 TOP100 2종 이상
4. 마지막 보강은 TOP100 1종 후보

테마는 거래대금과 강도점수를 기준으로 정렬하며, 작은 순위 변화로 카드가 계속 바뀌지 않도록 히스테리시스를 둡니다.

기본 교체 정책:

- 신규 후보가 기존 약한 테마보다 약 8% 이상 강하거나
- 3회 연속 우위를 확인한 경우 교체
- 환경변수: `THEME_REPLACEMENT_MARGIN`, `THEME_REPLACEMENT_CONFIRMATIONS`

## 5. 거래대금 가중 3분 테마선

테마 평균선은 더 이상 동일가중 단순평균이 아닙니다.

각 구성종목의 가격을 기준시점 대비 수익률로 변환하고, **각 3분 구간의 거래대금**을 가중치로 사용합니다.

예시:

```text
A 종목 +5% / 거래대금 100억
B 종목 -5% / 거래대금 900억
→ 테마 가중수익률 약 -4%
```

따라서 테마 안에서 거래대금이 압도적으로 큰 종목이 빠지면 테마선도 강하게 하락하고, 큰 거래대금이 실린 상승 종목은 테마선을 강하게 끌어올립니다. 모든 거래대금 가중치가 0/누락인 구간에만 단순평균으로 fallback합니다.

10초 live overlay도 현재 구성종목의 누적 거래대금 비중으로 가중합니다.

### 차트 시각화

- 실제 % 값 유지
- 강한 자동 Y축 확대
- 기존보다 큰 차트 높이
- 더 굵은 선과 현재점
- 0% 기준선 유지
- 실제 구간 고점/저점 표시

시각적으로 크게 보이더라도 수익률 데이터 자체를 인위적으로 배수 처리하지 않습니다.

## 6. 국내 테마 카탈로그

검증 카탈로그는 `backend/data/themes.kr.json`에서 관리합니다.

현재 카테고리:

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
- **광통신**

광통신은 거래대금 상위권의 대한광통신·우리로·옵티코어 등 관련 종목이 함께 강해질 때 별도 테마 후보로 잡을 수 있도록 0.6.1에서 추가했습니다.

AI가 임의 추정한 종목을 즉시 실제 집계에 넣지 않고 검토된 코드/키워드를 카탈로그에 반영하는 정책은 유지합니다.

## 7. 거래대금 TOP100 종목명

랭킹 원본에서 `name`이 비어 있거나 코드만 올 수 있으므로 별도 메타데이터를 결합합니다.

0.6.1 기준:

- TOP100 메타데이터를 25개씩 나눠 `/api/v1/stocks` 조회
- `name`, `stockName`, `displayName`, `shortName`, `koreanName` 후보 확인
- 중첩 `stock.*` 필드도 확인
- 정확히 6자리 숫자인 값은 종목명으로 인정하지 않음
- 실시간 `name=null` 또는 코드값이 기존 정상 종목명을 덮어쓰지 않음
- 아직 이름이 준비되지 않은 경우 UI에는 `종목명 확인 중` 표시

이름 문제 회귀는 `backend/stockMetadata.test.mjs`에서 검증합니다.

## 8. 시황 요약 정책

시황 요약의 하루 시작점은 **06:00 KST**입니다.

매 3분 뉴스 갱신 시 “새 기사만” 보는 것이 아니라 당일 06:00부터 현재까지 Google News RSS를 다시 검색합니다. 따라서 오전에 한 번 놓친 기사도 이후 검색에서 발견되면 추가할 수 있습니다.

동작:

```text
매 refresh
  → 06:00~현재 범위 재검색
  → 기존 오늘 후보와 합치기
  → 광고/리딩방/저가치 제거
  → 같은 링크/같은 사건 묶기
  → 시장영향 + 종목재료 + 테마촉매 평가
  → 시간순 타임라인 유지
```

검색 대상에는 다음이 포함됩니다.

- 현재 거래대금 상위 종목
- 현재 주도테마 5개
- 반도체/HBM/AI/데이터센터/광통신
- 원전/SMR/전력기기/방산/조선/바이오/로봇/2차전지
- 수주/공급/계약/투자/증설/정책/승인/허가/실적/M&A
- CPI/PCE/FOMC/연준/고용/관세/환율/유가
- 전쟁/호르무즈 등 지정학 이슈

이미 수집된 당일 비중복 후보는 유지합니다. 같은 링크나 같은 사건의 반복 기사는 중복 제거/통합합니다.

## 9. 뉴스 근거 등급

- `A`: DART/KRX/금융감독원/공시 등 1차자료 확인
- `B`: 복수 출처에서 같은 이슈 확인
- `C`: 단일 기사 또는 아직 1차자료 미확인

`/api/market/event-timeline`은 종목 3분 가격 흐름과 매칭된 뉴스 시간을 함께 제공합니다. 시간적 인접성을 인과관계로 표현하지 않습니다.

## 10. Market Intelligence

Market Intelligence는 다음 원시 데이터를 조합합니다.

- 상승 종목 비율
- 상승 종목 거래대금 비중
- TOP10 거래대금 집중도
- 외국인/기관 현물 순매수
- 차익/비차익 프로그램
- 테마 확산도
- 구성종목 중앙값 수익률
- 대장주 거래대금 집중도
- 10분 환산 자금 유입 속도
- 1시간/3시간 테마 변화

테마 생애주기:

`출현 / 확산 / 주도 / 과열 / 둔화 / 이탈 / 유지`

시장 상태는 `위험선호 우위`, `방어적 장세`, `상승 거래대금 우위`, `하락 거래대금 우위`, `중립 장세` 등으로 표시하며 근거값을 함께 보여줍니다.

## 11. 데이터 신선도와 품질 감시

신선도:

- `LIVE`
- `DELAYED`
- `STALE`
- `FALLBACK`
- `MISSING`

자동 품질 감지:

- 시장 스냅샷 지연
- 테마 원천 데이터 지연
- TOP100 표본 부족
- 상위 종목 등락률이 비정상적으로 동일함
- 누적 거래대금 역행

## 12. 장중 복기 / Close Archive

- `/api/market/replay`: 최근 장중 상태 복기
- `15:20 PRE_CLOSE`
- `15:35 FINAL`
- 기본 35거래일 보관

목적은 종가 전 강했던 테마/종목/수급이 실제 종가까지 유지됐는지 사후 비교하는 것입니다.

## 13. 선물 데이터

KOSPI200 선물은 검증된 공급원 URL이 연결된 경우에만 사용합니다.

- `FUTURES_SNAPSHOT_URL`
- `FUTURES_SNAPSHOT_TOKEN`
- `FUTURES_REFRESH_MS`

공급원이 없으면 `available=false`이며 가짜 계약수나 방향을 만들지 않습니다.

## 14. 주요 갱신 주기

기본값:

- 핵심 국내 시장 스냅샷: 장중 약 10초
- 테마 1분봉 수집/가중 3분 집계: 약 60초
- 시황 요약 재검색: 180초
- 느린 투자자/프로그램 데이터: 180초
- prepared JSON 게시: 최대 2초 단위
- 장 외 시간: 약 300초

## 15. 주요 API

- `/api/health`
- `/api/market/snapshot`
- `/api/market/theme-flow`
- `/api/market/theme-stock-chart`
- `/api/market/feature-news`
- `/api/market/intelligence`
- `/api/market/event-timeline`
- `/api/market/replay`
- `/api/market/close-archive`
- `/api/market/futures`

## 16. CI/CD

CI 검증:

- TypeScript type check
- Vitest unit tests
- Node backend tests
- backend HTTP smoke
- production Vite build
- runtime JS MIME smoke
- backend Docker build
- Playwright desktop/mobile tests

배포:

```text
작업 브랜치
 → PR
 → CI 성공
 → main 병합
 → main CI 성공
 → Raspberry Pi self-hosted runner
 → 검증된 frontend-dist 배포
 → 필요한 backend/frontend image만 재빌드
 → local health/snapshot/MIME 검증
 → Quick Tunnel / Runtime status 게시
```

공개 저장소의 PR 코드를 Pi runner에서 직접 실행하지 않고 **성공한 main push의 검증된 SHA만** 배포합니다.

## 17. 상태 파일

`tunnel-status/CURRENT_TUNNEL.md`
- 현재 Quick Tunnel URL
- tunnel 상태
- tunnel service scope

`tunnel-status/RUNTIME_STATUS.md`
- Pi 로컬 앱 상태
- 실제 배포 SHA
- 외부 터널 도달 가능 여부
- 상태 갱신 시각

앱 자체 정상 여부와 외부 터널 장애를 분리해서 봅니다.

## 18. 다음 세션 시작 순서

1. `PROJECT_STATUS.md`
2. `CHANGELOG.md`
3. `MEMORY.md`
4. `REQUESTS.md`
5. 최근 `main` 커밋과 열린 PR
6. 최근 GitHub Actions
7. `tunnel-status/CURRENT_TUNNEL.md`
8. `tunnel-status/RUNTIME_STATUS.md`
9. 사용자 신규 요청

이미 완료된 기능을 처음부터 다시 만들지 않습니다. 특히 **5개 테마, 거래대금 가중 테마선, 06:00 뉴스 재검색/누적, TOP100 종목명 메타데이터 결합**은 현재 기본 동작으로 취급합니다.
