# K-Market Flow

한국 주식의 섹터별 자금 흐름을 한 화면에서 보기 위한 취미용 전광판 프로젝트입니다. React 프론트엔드와 토스증권 Open API 백엔드를 Docker Compose로 함께 실행합니다.

## 가장 쉬운 실행 방법 · Windows

1. 이 저장소를 ZIP으로 내려받아 압축을 풉니다.
2. Docker Desktop을 설치하고 실행합니다.
3. `START_WINDOWS.bat`을 더블클릭합니다.
4. 첫 실행에만 `TOSS_CLIENT_ID`, `TOSS_CLIENT_SECRET`을 입력합니다. 입력값은 이 PC의 `.env` 파일에만 저장되고 Git에는 올라가지 않습니다.
5. 자동으로 프론트엔드와 백엔드가 빌드되고 `http://localhost:8080`이 열립니다.

토스증권 API가 `403`을 반환하면 토스증권 WTS의 `설정 → Open API → 허용 IP`에 Docker를 실행하는 PC의 현재 공인 IP를 등록해야 합니다.

## Docker 구성

```text
브라우저 :8080
   ↓
Nginx + React 프론트엔드
   ↓ /api
Node.js 백엔드 :8787 (Docker 내부 전용)
   ↓
토스증권 Open API
```

백엔드 포트는 외부에 직접 노출하지 않습니다. `client_secret`은 React 빌드에 포함되지 않고 백엔드 컨테이너에서만 사용합니다.

수동 실행이 필요하면 저장소 루트에 `.env.example`을 복사해 `.env`를 만든 뒤 아래 명령을 실행할 수 있습니다.

```bash
docker compose up -d --build
```

종료:

```bash
docker compose down
```

## 실시간 데이터 동작

- 현재가: 토스증권 국내주식 현재가 API
- 등락률: 토스 시장 전체 랭킹의 등락률을 우선 사용하고 없으면 전일 종가 대비 계산
- 통합 거래대금: KRX/NXT를 UI에서 분리하지 않고 통합 기준으로 사용
- 전체 거래대금 표시는 토스의 `시장 전체 거래대금 TOP100` 랭킹 합계
- 추적 종목이 TOP100 밖이면 당일 OHLCV를 이용한 거래대금 추정값을 `~` 표시
- 외국인/기관: 토스 투자자 매매동향의 KRX+NXT 통합 순매수량
- KOSPI/KOSDAQ: 토스 시장지표 API
- 화면 갱신: 기본 5초, 느린 수급/OHLCV 갱신은 기본 60초
- 시간축: 08:00~20:00, NXT 프리·KRX+NXT 장중·NXT 애프터까지 유지

현재 섹터/테마 매핑은 대표 종목 중심입니다. 전체 상장 종목을 완전하게 포함하는 단계는 별도의 종목→섹터/테마 매핑을 확장하면 됩니다.

## GitHub Secrets와 로컬 Docker의 차이

GitHub에 등록한 `TOSS_CLIENT_ID`, `TOSS_CLIENT_SECRET`은 GitHub Actions 환경에서만 사용할 수 있습니다. 사용자의 PC에서 실행되는 Docker는 GitHub Secrets를 자동으로 읽을 수 없기 때문에 `START_WINDOWS.bat` 첫 실행 때 같은 값을 한 번 입력해야 합니다. 이 값은 `.env`에 저장되며 `.gitignore`로 차단되어 있습니다.

GitHub Pages는 정적 사이트이므로 비밀키를 안전하게 사용할 수 없습니다. 따라서 Pages에서는 백엔드가 없으면 DEMO FALLBACK을 보여주고, 실제 토스 데이터는 Docker로 실행한 `http://localhost:8080`에서 사용합니다. 공개 인터넷에서도 실시간으로 보려면 나중에 고정 IP가 있는 백엔드를 별도로 배포해야 합니다.

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

GitHub Actions에서도 TypeScript, 프론트 단위 테스트, 백엔드 테스트, 프로덕션 빌드, Docker 이미지 빌드, Playwright 브라우저 테스트를 자동 검증합니다.

## 프로젝트 작업 규칙

- AI 행동 규칙: `AGENTS.md`
- ChatGPT 중심 흐름: `WORKFLOW.md`, `CHAT_CONTROL.md`
- 장기 결정: `MEMORY.md`
- 변경 기록: `CHANGELOG.md`
- 자유 실험 규칙: `SURPRISE.md`
