# Changelog

## 0.4.0
- 토스증권 Open API 기반 읽기 전용 시장 데이터 백엔드 추가
- OAuth Client Credentials 토큰 캐시, 401 재인증, 429 재시도 처리 추가
- KRX/NXT를 화면에서 분리하지 않는 통합 현재가·거래대금 구조 적용
- 토스 시장 전체 거래대금 TOP100 랭킹과 추적 종목 OHLCV 추정 거래대금 결합
- 외국인/기관 KRX+NXT 통합 순매수량을 Money Flow 계산에 연결
- KOSPI/KOSDAQ 시장지표 연결 및 5초 시세 갱신 구조 추가
- Timeline을 08:00~20:00으로 확장해 NXT 프리/애프터 구간까지 유지
- Docker Compose로 React+Nginx 프론트엔드와 Node.js 백엔드를 한 번에 실행하도록 구성
- Windows용 `START_WINDOWS.bat` / `START_WINDOWS.ps1` 원클릭 실행기 추가
- 비밀키는 로컬 `.env`와 백엔드 컨테이너에서만 사용하고 프론트엔드에는 포함하지 않도록 분리
- 토스 Open API 허용 IP 오류를 화면에서 설명하도록 처리
- 백엔드 세션 단위 테스트, Docker 이미지 빌드 CI, 08:00~20:00 Playwright 검증 추가
- GitHub Pages는 비밀키 없는 정적 DEMO FALLBACK을 유지하고 실제 토스 데이터는 로컬 Docker에서 제공

## 0.3.0
- 한국 주식 섹터 Money Flow 전광판 메인 화면 추가
- KOSPI/KOSDAQ 지수, 상승/하락 종목 수, 거래대금, 외국인/기관 수급 요약 추가
- 섹터 Heatmap과 Money Flow Ranking 추가
- 섹터 → 세부테마 → 종목 Drill-down 탐색 추가
- 09:00~15:30 Timeline Replay 슬라이더 추가
- 등락률, 거래대금, 상승종목 비율, 외국인/기관 수급을 조합한 Money Flow Score 구현
- 전광판/트레이딩룸 스타일의 어두운 반응형 UI 적용
- 기존 종목 퀴즈는 상단 메뉴의 별도 화면으로 유지
- Playwright 브라우저 테스트와 Money Flow Score 단위 테스트 추가
- 현재 시장 데이터는 화면과 상호작용 검증용 DEMO SNAPSHOT이며 실시간 데이터 제공자 연결을 위한 구조로 분리 가능

## 0.2.0
- 종목명을 보고 4개의 기업 설명 중 정답을 고르는 주식 기업 맞히기 게임 추가
- 삼성전자, SK하이닉스, 현대차, NAVER, 한화에어로스페이스 샘플 문제 추가
- 정답/오답 피드백, 점수, 진행률, 결과 화면, 다시 도전하기 기능 추가
- 모바일 반응형 UI와 키보드 포커스 접근성 추가
- 퀴즈 정답 판정 단위 테스트와 Playwright 브라우저 테스트 추가

## 0.1.0
- 바이브코딩 기본 프로젝트 생성
- React + TypeScript + Vite 구성
- Vitest 단위 테스트 구성
- Playwright 브라우저 테스트 구성
- GitHub Actions CI 구성
- AI 자율 개발 규칙 및 프로젝트 메모 구조 추가
- 기본 3D 인터랙션 데모 추가
