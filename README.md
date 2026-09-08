# Vibe Coding Starter

ChatGPT와 GitHub를 중심으로 취미 바이브코딩을 빠르게 시작하기 위한 기본 프로젝트입니다.

## 로컬 실행

Node.js 22 이상 권장.

```bash
npm install
npm run dev
```

브라우저에서 Vite가 표시하는 로컬 주소를 엽니다.

## 전체 검증

```bash
npm run check
npm run test
npm run build
npm run test:e2e
```

Playwright를 처음 사용할 때 브라우저가 없다면:

```bash
npx playwright install chromium
```

## 작업 방식

- 아이디어: `REQUESTS.md`
- AI 행동 규칙: `AGENTS.md`
- 장기 프로젝트 기억: `MEMORY.md`
- 변경 기록: `CHANGELOG.md`
- 자유 실험 규칙: `SURPRISE.md`

## GitHub Actions

`main` 또는 Pull Request에 코드가 올라오면 다음을 자동 검증합니다.

1. 의존성 설치
2. TypeScript 검사
3. 단위 테스트
4. 프로덕션 빌드
5. Playwright 브라우저 테스트
6. 실패 시 Playwright 리포트 업로드

같은 테스트를 무한 재시도하지 않습니다. 실패 원인은 AI가 로그를 분석한 뒤 코드 또는 접근 전략을 바꾸는 방식으로 해결합니다.
