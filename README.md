<div align="center">

# MARKET FLOW

### 한국·미국 시장의 자금 흐름, 테마 회전, 시황 뉴스를 빠르게 읽는 개인 Market Lab

[![CI](https://github.com/juhwan7/vibe-coding-playground/actions/workflows/ci.yml/badge.svg)](https://github.com/juhwan7/vibe-coding-playground/actions/workflows/ci.yml)
[![Raspberry Pi Deploy](https://github.com/juhwan7/vibe-coding-playground/actions/workflows/deploy-to-pi.yml/badge.svg)](https://github.com/juhwan7/vibe-coding-playground/actions/workflows/deploy-to-pi.yml)
![React](https://img.shields.io/badge/React-19-20232a?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Raspberry_Pi-2496ed?logo=docker&logoColor=white)

**거래대금 TOP100 · 5개 주도테마 · 거래대금 가중 3분 선차트 · 06:00 시황 요약 · 수급 · Replay**

### 현재 실제 접속 주소

**https://logged-knee-yard-library.trycloudflare.com**

> Cloudflare Quick Tunnel 주소는 바뀔 수 있습니다. 최신 주소와 상태는 [`tunnel-status/CURRENT_TUNNEL.md`](https://github.com/juhwan7/vibe-coding-playground/blob/tunnel-status/CURRENT_TUNNEL.md)에서 확인합니다.

</div>

---

## 프로젝트 목적

`MARKET FLOW`는 단순한 주식 시세표가 아니라 **오늘 시장의 돈이 어디에 몰리고, 어느 테마가 주도권을 얻거나 잃고 있는지 한 화면에서 확인하기 위한 개인용 시장 전광판**입니다.

핵심 원칙은 세 가지입니다.

1. 숫자를 임의로 만들거나 과장하지 않습니다. 실제 데이터가 없으면 `-`, `MISSING`, `실데이터 미연결`로 표시합니다.
2. 차트는 움직임을 잘 보이게 확대할 수 있지만 **실제 등락률 자체를 바꾸지 않습니다.**
3. 뉴스와 가격 움직임을 함께 보여줄 수는 있지만, 시간적으로 가까웠다는 이유만으로 인과관계를 단정하지 않습니다.

---

## 현재 주요 화면

| 화면 | 핵심 기능 |
| --- | --- |
| **증시 자금** | KOSPI·KOSDAQ, 거래대금 TOP100 커버리지, 외국인·기관, 프로그램, 시장 상태 엔진 |
| **국내 테마 흐름** | 거래대금 상위 개별주를 테마로 묶어 **5개 주도테마**를 유지하고 거래대금 가중 3분 선차트 비교 |
| **시황 요약** | **매일 06:00 KST 이후** 중요 뉴스를 재검색·누적하고 테마 촉매/거래대금 집중 종목/매크로 이슈를 중복 제거 후 요약 |
| **미국 테마 흐름** | 미국 거래대금 상위 종목을 주요 테마로 묶어 회전 비교 |
| **시장 Intelligence** | 상승 확산도, 집중도, 외국인/기관/프로그램 수급, 데이터 신선도와 품질 상태 표시 |
| **Replay / Close Archive** | 장중 히스토리 복기와 15:20 PRE_CLOSE / 15:35 FINAL 스냅샷 비교 |
| **종목 퀴즈** | KOSPI 200 / KOSDAQ 150 실제 구성종목의 기업 설명 기반 4지선다 |

---

## 국내 테마 엔진

### 1. 테마 후보 선정

```text
국내 거래대금 TOP100
        ↓
ETF·ETN 등 비개별주 제거
        ↓
TOP50에서 같은 테마 3종 이상 우선 탐색
        ↓ 부족하면
TOP50 2종 → TOP100 2종 → TOP100 1종 순으로 보강
        ↓
거래대금과 시장 강도를 계산
        ↓
최종 화면 5개 테마 유지
```

작은 순위 차이 때문에 테마가 계속 바뀌지 않도록 히스테리시스를 둡니다. 기본적으로 새로운 후보가 기존 약한 테마보다 충분히 강하거나 여러 번 연속 우위를 보여야 교체됩니다.

현재 검증 카탈로그는 `backend/data/themes.kr.json`에서 관리합니다. 반도체, 원전, 전력기기, 방산, 조선, 2차전지, 바이오, 인터넷·게임, 자동차, 금융, 로봇에 더해 **광통신** 테마를 포함합니다.

### 2. 거래대금 가중 평균 차트

예전의 단순평균 대신 **각 3분 구간의 실제 거래대금을 가중치로 사용**합니다.

```text
종목 A: +5% / 3분 거래대금 100억
종목 B: -5% / 3분 거래대금 900억

단순평균     = 0%
거래대금 가중 = 약 -4%
```

즉 바이오 테마에서 거래대금이 압도적으로 큰 종목이 강하게 빠지면 바이오 테마선도 빠르게 아래로 움직입니다. 반대로 대규모 거래대금이 실린 종목이 강하게 오르면 테마선의 상승 기울기도 커집니다. 이를 통해 **실제로 돈이 실린 방향**을 눈으로 더 쉽게 느끼도록 설계했습니다.

모든 구성종목의 거래대금이 누락된 특수한 구간에서만 단순평균으로 안전하게 폴백합니다.

### 3. 변동폭 시각화

차트는 실제 퍼센트를 그대로 사용하면서 세로 Y축 여백을 매우 작게 잡는 **강한 자동 확대축**을 사용합니다. 따라서 0.2~0.5% 정도의 작은 장중 변화도 이전보다 훨씬 크게 보입니다.

- 실제 % 값 변경 없음
- 0% 기준선 유지
- 높은 차트 높이와 굵은 선 사용
- 실제 구간 고점/저점 표시
- 툴팁/표시값은 원본 수익률 유지

### 4. 종목 클릭 3분 선차트

테마 구성종목을 클릭하면 해당 종목의 3분 선차트를 약 5초간 표시한 뒤 테마 차트로 돌아옵니다. Pi에 해당 종목의 장중 데이터가 아직 없다면 백엔드가 1분봉을 보강하고 3분 단위로 묶어 보여줍니다. 가짜 OHLC 데이터는 생성하지 않습니다.

---

## 거래대금 TOP100 종목명 처리

랭킹 API에 종목명이 비어 있거나 종목코드만 들어오는 경우가 있어 별도의 종목 메타데이터를 결합합니다.

TOP100 메타데이터는 한 번에 과도하게 요청하지 않고 **25종목씩 나눠 조회**합니다. `name`, `stockName`, `displayName`, `shortName`, `koreanName` 등을 확인하고 6자리 숫자 코드 자체는 종목명으로 인정하지 않습니다.

종목명을 아직 확보하지 못한 짧은 순간에는 코드를 종목명처럼 중복 표시하지 않고 `종목명 확인 중`으로 표시합니다.

---

## 시황 요약: 06:00부터 하루 전체를 놓치지 않기

시황 요약은 단순히 “최근 3분 기사”만 보는 구조가 아닙니다. **매 갱신 때마다 당일 06:00 이후 범위를 다시 검색**하고, 앞서 찾은 중요 후보도 메모리에 누적합니다.

```text
06:00 이후 기사 검색
      ↓
거래대금 상위 종목 + 현재 5개 테마 + 시장 매크로 키워드 검색
      ↓
광고 / 리딩방 / 저가치 기사 제거
      ↓
같은 사건의 재송고·유사 기사 묶기
      ↓
테마 촉매와 시장 영향도 평가
      ↓
기존에 저장된 오늘 기사와 합치기
      ↓
시간순 시황 타임라인
```

주요 탐색 대상은 다음과 같습니다.

- 수주, 공급계약, 투자, 증설, 정책, 정부지원, 승인, 허가, 임상, 실적, M&A
- 반도체/HBM/AI/데이터센터/광통신/원전/SMR/전력/방산/조선/바이오/로봇/2차전지
- 거래대금 상위 종목의 직접 재료
- CPI, PCE, FOMC, 연준, 고용, 관세, 환율, 유가
- 이란·이스라엘·호르무즈 등 시장에 영향을 줄 수 있는 지정학 이슈

같은 링크와 같은 이슈의 반복 보도는 제거하거나 하나로 묶습니다. 반대로 오전에 한 번 놓쳤던 기사라도 이후 재검색에서 발견되고 기존 이슈와 중복이 아니면 **당일 타임라인에 뒤늦게라도 추가**됩니다.

---

## Market Intelligence

원시 테마 순위 외에 시장 전체 상태를 설명하기 위한 규칙 기반 엔진이 있습니다.

- 상승 종목 비율
- 상승 종목 거래대금 비중
- TOP10 거래대금 집중도
- 외국인·기관 현물 순매수
- 차익/비차익 프로그램
- 주도테마 확산도
- 테마별 대장주 집중도
- 10분 환산 자금 유입 속도
- 테마 생애주기: `출현 / 확산 / 주도 / 과열 / 둔화 / 이탈 / 유지`

시장/테마/뉴스/선물 데이터는 `LIVE / DELAYED / STALE / FALLBACK / MISSING` 상태로 신선도를 표시할 수 있습니다.

뉴스 근거 등급은 다음과 같습니다.

- `A`: 공시·KRX·금융감독원 등 1차자료 확인
- `B`: 복수 출처에서 같은 이슈 확인
- `C`: 단일 기사 또는 아직 1차자료 미확인

---

## 데이터 수집과 Raspberry Pi 구조

사용자가 페이지를 열 때 데이터 수집을 처음 시작하지 않습니다. Raspberry Pi가 계속 수집하고 **마지막 정상 결과를 미리 준비**합니다.

```text
Toss / News / Optional Futures Provider
                ↓
       Raspberry Pi backend
                ↓
market snapshot / history / theme candles
                ↓
     Market Intelligence 계산
                ↓
        prepared JSON 생성
                ↓
       Nginx가 직접 제공
                ↓
             React UI
                ↓
       Cloudflare Quick Tunnel
```

주요 prepared 파일:

```text
market-snapshot.json
market-history.json
kr-theme-flow.json
market-intelligence.json
us-theme-flow.json
feature-news.json
```

새 수집이 실패해도 마지막 정상 파일을 즉시 지우지 않습니다.

### 기본 갱신 정책

- 국내 핵심 시장 스냅샷: **장중 약 10초**
- 테마 1분봉 수집/3분 집계: 기본 **60초**
- 시황 뉴스 재검색: **180초**
- 느린 수급/상세 데이터: 기본 **180초**
- prepared JSON 게시: 최대 **2초 단위**
- 장 외 시간: 최대 **5분** 수준으로 완화
- Toss 요청: 기본 동시 2개, 2초당 최대 5개 시작

---

## 데이터 소스

- **토스증권 Open API**: 국내/미국 시세, 거래대금 랭킹, 분봉, 일부 투자자/프로그램 데이터
- **KRX Data Marketplace**: KOSPI 200 / KOSDAQ 150 구성종목
- **Npay 증권 / FnGuide 표기 정보**: 종목 퀴즈 기업 설명 보조
- **Google News RSS**: 시황·테마·특징주 기사 탐색과 원문 링크
- **공공데이터**: 투자자예탁금·CMA·신용융자·미수금 영역 연결 준비
- **선물 공급원**: `FUTURES_SNAPSHOT_URL`이 검증된 경우에만 사용

실제 공급원이 없는 값을 추정해서 채우지 않습니다.

---

## CI / 자동배포

작업은 보통 다음 흐름으로 진행합니다.

```text
ChatGPT 요청
   ↓
작업 브랜치
   ↓
Pull Request
   ↓
GitHub Actions CI
   ├─ TypeScript
   ├─ Vitest
   ├─ Node backend tests
   ├─ HTTP smoke
   ├─ Production build
   ├─ Docker build
   └─ Playwright desktop/mobile
   ↓
main 병합
   ↓
main CI 재검증
   ↓
Raspberry Pi self-hosted runner 자동배포
   ↓
local health / snapshot / JS MIME 검증
   ↓
Cloudflare Tunnel 상태 게시
```

프론트엔드는 GitHub-hosted CI에서 미리 빌드한 `dist`를 Pi로 보내기 때문에 Raspberry Pi에서 React/Vite를 다시 컴파일하지 않습니다.

`.env`, API Client Secret, 토큰 등은 공개 저장소에 커밋하지 않습니다.

---

## 로컬 실행

Windows에서는 가장 간단하게 다음 순서로 실행합니다.

1. Docker Desktop 실행
2. 저장소의 `START_WINDOWS.bat` 실행
3. 처음 한 번 `TOSS_CLIENT_ID`, `TOSS_CLIENT_SECRET` 입력
4. `http://localhost:8080` 접속

토스 API가 403을 반환하면 실행 서버의 공인 IP가 토스 Open API 허용 IP에 등록되어 있는지 확인합니다.

---

## 프로젝트 상태 문서

새 ChatGPT 세션이나 다음 작업은 먼저 [`PROJECT_STATUS.md`](PROJECT_STATUS.md)를 읽습니다. 이후 [`CHANGELOG.md`](CHANGELOG.md), [`MEMORY.md`](MEMORY.md), 최근 `main`, 열린 PR, Actions, `tunnel-status` 상태를 확인합니다.

주요 문서 역할:

- `PROJECT_STATUS.md`: 현재 시스템의 사실상 최신 설계/운영 상태
- `CHANGELOG.md`: 버전별 변경사항
- `MEMORY.md`: 장기적으로 유지할 기술 결정
- `REQUESTS.md`: 최근 사용자 요구사항과 완료 상태
- `AGENTS.md`: ChatGPT 자율 개발 규칙
- `WORKFLOW.md`: 브랜치 → CI → 배포 작업 흐름

---

## 투자 관련 주의

이 프로젝트는 개인적인 시장 학습·관찰용 도구입니다. 화면의 테마 강도, 뉴스, 수급, 시장 상태는 데이터를 정리해 보여주는 기능이며 특정 종목의 매수·매도 판단을 자동으로 대신하지 않습니다.
