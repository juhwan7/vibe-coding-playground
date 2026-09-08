# Changelog

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
