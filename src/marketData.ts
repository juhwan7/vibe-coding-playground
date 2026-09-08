export type Stock = {
  name: string
  ticker: string
  market: 'KOSPI' | 'KOSDAQ'
  change: number
  turnover: number
  foreign: number
  institution: number
  price?: number | null
  volume?: number
  turnoverEstimated?: boolean
}

export type Theme = { name: string; stocks: Stock[] }

export type Sector = {
  name: string
  change: number
  turnover: number
  advancers: number
  decliners: number
  foreign: number
  institution: number
  themes: Theme[]
  supplyStrength?: number
}

export type LiveStock = {
  symbol: string
  name?: string
  market?: string
  lastPrice: number | null
  basePrice: number | null
  changeRate: number | null
  tradingAmount: number | null
  tradingVolume: number | null
  foreignNetBuyVolume: number | null
  institutionNetBuyVolume: number | null
  updatedAt: string | null
  tradingAmountSource?: 'ranking' | 'ohlcv-estimate' | null
}

export type MarketSnapshot = {
  ok: boolean
  mode: 'live' | 'degraded'
  updatedAt: string
  marketSession: string
  error?: string | null
  indices: Record<string, { lastPrice: number | null; changeRate: number | null; updatedAt: string | null }>
  stocks: Record<string, LiveStock>
  marketTradingAmount: number | null
  rankedAt?: string | null
}

export const sectorTemplates: Sector[] = [
  {
    name: '반도체', change: 2.64, turnover: 9.8, advancers: 34, decliners: 9, foreign: 2420, institution: 1180,
    themes: [
      { name: 'HBM', stocks: [
        { name: 'SK하이닉스', ticker: '000660', market: 'KOSPI', change: 4.18, turnover: 2.18, foreign: 1380, institution: 420 },
        { name: '한미반도체', ticker: '042700', market: 'KOSPI', change: 5.31, turnover: 0.74, foreign: 240, institution: 95 },
      ] },
      { name: '메모리/파운드리', stocks: [
        { name: '삼성전자', ticker: '005930', market: 'KOSPI', change: 1.82, turnover: 3.92, foreign: 860, institution: 540 },
        { name: 'DB하이텍', ticker: '000990', market: 'KOSPI', change: 2.11, turnover: 0.19, foreign: 62, institution: 31 },
      ] },
    ],
  },
  {
    name: '원전·전력', change: 3.42, turnover: 3.6, advancers: 21, decliners: 4, foreign: 680, institution: 490,
    themes: [
      { name: '원전', stocks: [
        { name: '두산에너빌리티', ticker: '034020', market: 'KOSPI', change: 4.67, turnover: 1.21, foreign: 410, institution: 265 },
        { name: '한전기술', ticker: '052690', market: 'KOSPI', change: 3.21, turnover: 0.22, foreign: 66, institution: 41 },
      ] },
      { name: '전력기기', stocks: [
        { name: 'HD현대일렉트릭', ticker: '267260', market: 'KOSPI', change: 3.88, turnover: 0.53, foreign: 172, institution: 109 },
        { name: '효성중공업', ticker: '298040', market: 'KOSPI', change: 2.74, turnover: 0.31, foreign: 84, institution: 77 },
      ] },
    ],
  },
  {
    name: '방산·조선', change: 1.93, turnover: 4.4, advancers: 25, decliners: 11, foreign: 940, institution: 620,
    themes: [
      { name: '방산', stocks: [
        { name: '한화에어로스페이스', ticker: '012450', market: 'KOSPI', change: 2.81, turnover: 0.88, foreign: 245, institution: 202 },
        { name: 'LIG넥스원', ticker: '079550', market: 'KOSPI', change: 2.34, turnover: 0.34, foreign: 91, institution: 63 },
      ] },
      { name: '조선', stocks: [
        { name: '한화오션', ticker: '042660', market: 'KOSPI', change: 1.77, turnover: 0.71, foreign: 188, institution: 102 },
        { name: 'HD한국조선해양', ticker: '009540', market: 'KOSPI', change: 1.26, turnover: 0.36, foreign: 106, institution: 74 },
      ] },
    ],
  },
  {
    name: '바이오', change: 0.86, turnover: 4.9, advancers: 48, decliners: 39, foreign: 350, institution: -120,
    themes: [
      { name: '신약/플랫폼', stocks: [
        { name: '알테오젠', ticker: '196170', market: 'KOSDAQ', change: 2.42, turnover: 0.84, foreign: 136, institution: -18 },
        { name: '에이비엘바이오', ticker: '298380', market: 'KOSDAQ', change: 1.89, turnover: 0.41, foreign: 77, institution: 21 },
      ] },
      { name: '바이오시밀러', stocks: [
        { name: '셀트리온', ticker: '068270', market: 'KOSPI', change: 0.51, turnover: 0.46, foreign: 88, institution: -34 },
      ] },
    ],
  },
  {
    name: '2차전지', change: -1.72, turnover: 4.1, advancers: 12, decliners: 38, foreign: -980, institution: -420,
    themes: [
      { name: '셀', stocks: [
        { name: 'LG에너지솔루션', ticker: '373220', market: 'KOSPI', change: -1.33, turnover: 0.71, foreign: -204, institution: -112 },
        { name: '삼성SDI', ticker: '006400', market: 'KOSPI', change: -2.11, turnover: 0.52, foreign: -161, institution: -96 },
      ] },
      { name: '소재', stocks: [
        { name: '에코프로비엠', ticker: '247540', market: 'KOSDAQ', change: -2.86, turnover: 0.61, foreign: -144, institution: -58 },
      ] },
    ],
  },
  {
    name: '인터넷·게임', change: -0.64, turnover: 2.3, advancers: 14, decliners: 24, foreign: -220, institution: 70,
    themes: [
      { name: '플랫폼', stocks: [
        { name: 'NAVER', ticker: '035420', market: 'KOSPI', change: -0.41, turnover: 0.44, foreign: -73, institution: 44 },
        { name: '카카오', ticker: '035720', market: 'KOSPI', change: -1.12, turnover: 0.31, foreign: -92, institution: 12 },
      ] },
      { name: '게임', stocks: [
        { name: '크래프톤', ticker: '259960', market: 'KOSPI', change: 0.38, turnover: 0.18, foreign: 31, institution: 17 },
      ] },
    ],
  },
  {
    name: '자동차', change: 1.18, turnover: 3.8, advancers: 27, decliners: 13, foreign: 520, institution: 260,
    themes: [{ name: '완성차', stocks: [
      { name: '현대차', ticker: '005380', market: 'KOSPI', change: 1.44, turnover: 0.92, foreign: 281, institution: 122 },
      { name: '기아', ticker: '000270', market: 'KOSPI', change: 1.16, turnover: 0.68, foreign: 190, institution: 91 },
    ] }],
  },
  {
    name: '금융', change: -0.21, turnover: 2.6, advancers: 19, decliners: 21, foreign: 80, institution: -90,
    themes: [{ name: '은행', stocks: [
      { name: 'KB금융', ticker: '105560', market: 'KOSPI', change: 0.22, turnover: 0.29, foreign: 73, institution: -14 },
      { name: '신한지주', ticker: '055550', market: 'KOSPI', change: -0.37, turnover: 0.17, foreign: 21, institution: -28 },
    ] }],
  },
]

export const watchSymbols = [...new Set(sectorTemplates.flatMap((sector) => sector.themes.flatMap((theme) => theme.stocks.map((stock) => stock.ticker))))]

export function moneyFlowScore(input: Pick<Sector, 'change' | 'turnover' | 'advancers' | 'decliners' | 'foreign' | 'institution' | 'supplyStrength'>) {
  const breadth = (input.advancers / Math.max(1, input.advancers + input.decliners) - 0.5) * 2
  const turnover = Math.min(input.turnover / 10, 1)
  const supply = input.supplyStrength ?? Math.max(-1, Math.min(1, (input.foreign + input.institution) / 3000))
  const momentum = Math.max(-1, Math.min(1, input.change / 5))
  return Math.round((momentum * 35 + turnover * 20 + breadth * 20 + supply * 25) * 10) / 10
}

export function mergeLiveSectors(snapshot: MarketSnapshot | null): Sector[] {
  if (!snapshot?.ok) return sectorTemplates
  return sectorTemplates.map((sector) => {
    const themes = sector.themes.map((theme) => ({
      ...theme,
      stocks: theme.stocks.map((stock) => {
        const live = snapshot.stocks[stock.ticker]
        if (!live) return stock
        return {
          ...stock,
          price: live.lastPrice,
          change: live.changeRate ?? stock.change,
          turnover: live.tradingAmount != null ? live.tradingAmount / 1_000_000_000_000 : stock.turnover,
          volume: live.tradingVolume ?? 0,
          foreign: live.foreignNetBuyVolume ?? 0,
          institution: live.institutionNetBuyVolume ?? 0,
          turnoverEstimated: live.tradingAmountSource === 'ohlcv-estimate',
        }
      }),
    }))
    const stocks = themes.flatMap((theme) => theme.stocks)
    const turnoverWon = stocks.reduce((sum, stock) => sum + stock.turnover * 1_000_000_000_000, 0)
    const weightedChange = turnoverWon > 0
      ? stocks.reduce((sum, stock) => sum + stock.change * stock.turnover * 1_000_000_000_000, 0) / turnoverWon
      : stocks.reduce((sum, stock) => sum + stock.change, 0) / Math.max(1, stocks.length)
    const advancers = stocks.filter((stock) => stock.change > 0).length
    const decliners = stocks.filter((stock) => stock.change < 0).length
    const foreign = stocks.reduce((sum, stock) => sum + stock.foreign, 0)
    const institution = stocks.reduce((sum, stock) => sum + stock.institution, 0)
    const volume = stocks.reduce((sum, stock) => sum + (stock.volume ?? 0), 0)
    const supplyStrength = Math.max(-1, Math.min(1, (foreign + institution) / Math.max(1, volume * 0.08)))
    return { ...sector, themes, change: weightedChange, turnover: turnoverWon / 1_000_000_000_000, advancers, decliners, foreign, institution, supplyStrength }
  })
}
