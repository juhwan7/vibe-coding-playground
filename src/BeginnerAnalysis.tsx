import './beginnerAnalysis.css'

type BeginnerAnalysisProps = {
  onNavigate: (page: 'flow' | 'liquidity' | 'daily-issues') => void
}

const STEPS = [
  {
    number: '01',
    title: '지금 어디에 돈이 들어오나?',
    description: '먼저 강한 테마와 거래대금이 몰리는 곳을 봅니다. 개별 종목부터 찾기보다 시장의 큰 흐름을 먼저 확인합니다.',
    action: '국내 테마 흐름 보기',
    page: 'flow' as const,
  },
  {
    number: '02',
    title: '왜 움직이고 있나?',
    description: '뉴스와 재료를 확인하되, 가격 움직임과 가까운 시간에 나왔다는 이유만으로 원인이라고 단정하지 않습니다.',
    action: '금일 이슈 정리 보기',
    page: 'daily-issues' as const,
  },
  {
    number: '03',
    title: '시장 전체 분위기는 어떤가?',
    description: '외국인·기관 수급과 거래대금, 시장 주변자금을 함께 확인해 한 종목의 움직임을 시장 전체와 비교합니다.',
    action: '증시 자금 보기',
    page: 'liquidity' as const,
  },
]

export default function BeginnerAnalysis({ onNavigate }: BeginnerAnalysisProps) {
  return (
    <main className="beginner-analysis" data-testid="beginner-analysis">
      <section className="beginner-hero">
        <div>
          <p className="beginner-eyebrow">BEGINNER VIEW</p>
          <h1>주식이 처음이라면<br />이 3가지만 먼저 보세요</h1>
          <p className="beginner-lead">
            복잡한 숫자를 전부 볼 필요는 없습니다. 시장의 돈이 어디로 움직이는지,
            왜 움직이는지, 전체 분위기가 어떤지만 순서대로 확인하면 됩니다.
          </p>
        </div>
        <div className="beginner-summary-card" aria-label="초보자 시장 확인 순서">
          <span>오늘의 확인 순서</span>
          <strong>돈의 흐름 → 이유 → 시장 분위기</strong>
          <p>종목을 고르기 전에 먼저 시장을 읽는 습관을 만드는 화면입니다.</p>
        </div>
      </section>

      <section className="beginner-steps" aria-label="초보자 주식 분석 3단계">
        {STEPS.map((step) => (
          <article className="beginner-step-card" key={step.number}>
            <span className="beginner-step-number">{step.number}</span>
            <h2>{step.title}</h2>
            <p>{step.description}</p>
            <button type="button" onClick={() => onNavigate(step.page)}>{step.action}</button>
          </article>
        ))}
      </section>

      <section className="beginner-guide">
        <div>
          <p className="beginner-eyebrow">초보자 원칙</p>
          <h2>뉴스 하나만 보고 주가 원인을 단정하지 마세요</h2>
        </div>
        <div className="beginner-guide-grid">
          <div>
            <strong>확인된 사실</strong>
            <span>실제 가격, 거래대금, 수급, 공시처럼 데이터로 확인되는 내용</span>
          </div>
          <div>
            <strong>가능성이 높은 이유</strong>
            <span>시장·업종·뉴스 흐름을 함께 봤을 때 설명력이 높은 요인</span>
          </div>
          <div>
            <strong>추정</strong>
            <span>아직 근거가 충분하지 않아 가능성으로만 봐야 하는 해석</span>
          </div>
        </div>
      </section>
    </main>
  )
}
