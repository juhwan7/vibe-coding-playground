export const WATCHLIST = [
  ['005930', '삼성전자', 'KOSPI'], ['000660', 'SK하이닉스', 'KOSPI'], ['042700', '한미반도체', 'KOSPI'], ['000990', 'DB하이텍', 'KOSPI'],
  ['034020', '두산에너빌리티', 'KOSPI'], ['052690', '한전기술', 'KOSPI'], ['267260', 'HD현대일렉트릭', 'KOSPI'], ['298040', '효성중공업', 'KOSPI'],
  ['012450', '한화에어로스페이스', 'KOSPI'], ['079550', 'LIG넥스원', 'KOSPI'], ['042660', '한화오션', 'KOSPI'], ['009540', 'HD한국조선해양', 'KOSPI'],
  ['196170', '알테오젠', 'KOSDAQ'], ['298380', '에이비엘바이오', 'KOSDAQ'], ['068270', '셀트리온', 'KOSPI'],
  ['373220', 'LG에너지솔루션', 'KOSPI'], ['006400', '삼성SDI', 'KOSPI'], ['247540', '에코프로비엠', 'KOSDAQ'],
  ['035420', 'NAVER', 'KOSPI'], ['035720', '카카오', 'KOSPI'], ['259960', '크래프톤', 'KOSPI'],
  ['005380', '현대차', 'KOSPI'], ['000270', '기아', 'KOSPI'], ['105560', 'KB금융', 'KOSPI'], ['055550', '신한지주', 'KOSPI'],
].map(([symbol, name, market]) => ({ symbol, name, market }))

export const WATCH_SYMBOLS = WATCHLIST.map((item) => item.symbol)
