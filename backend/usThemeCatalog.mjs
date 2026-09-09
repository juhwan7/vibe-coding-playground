const CATALOG = {
  'AI 반도체': new Set(['NVDA','AMD','AVGO','MU','MRVL','ARM','QCOM','INTC','TSM','ASML','AMAT','LRCX','KLAC']),
  'AI 플랫폼·빅테크': new Set(['MSFT','META','GOOGL','GOOG','AMZN','ORCL','AAPL']),
  'AI 소프트웨어': new Set(['PLTR','CRM','NOW','SNOW','DDOG','MDB','AI','PATH','SOUN','TEM','APP']),
  '클라우드·데이터센터': new Set(['MSFT','AMZN','GOOGL','GOOG','ORCL','VRT','ANET','SMCI','DELL','HPE','CRWV','EQIX','DLR','CSCO']),
  '전력·원전': new Set(['CEG','VST','NRG','GEV','OKLO','SMR','CCJ','LEU','BWXT','TLN']),
  '전기차·자율주행': new Set(['TSLA','RIVN','LCID','GM','F','MBLY','LAZR']),
  '양자컴퓨팅': new Set(['IONQ','RGTI','QBTS','QUBT','ARQQ']),
  '우주·방산': new Set(['RKLB','ASTS','LUNR','RDW','LMT','NOC','RTX','GD','LHX','BA']),
  '암호화폐·디지털자산': new Set(['COIN','MSTR','MARA','RIOT','CLSK','IREN','CIFR','HOOD']),
  '금융·결제': new Set(['JPM','BAC','WFC','C','GS','MS','SCHW','COF','AXP','V','MA','PYPL','HOOD']),
  '바이오·제약': new Set(['LLY','NVO','UNH','MRK','JNJ','MRNA','BNTX','REGN','VRTX','AMGN','GILD','BIIB','PFE','ABBV']),
  '에너지': new Set(['XOM','CVX','COP','OXY','SLB','HAL','EOG','MPC','PSX']),
  '소비·유통': new Set(['WMT','COST','HD','LOW','MCD','NKE','SBUX','TGT','PG','KO','PEP']),
  '미디어·스트리밍': new Set(['NFLX','DIS','CMCSA','SPOT','ROKU','WBD','TKO']),
  '희토류·광물': new Set(['MP','UUUU','LAC','ALB','FCX','NEM','CLF']),
  '로봇·자동화': new Set(['ISRG','SYM','TER','ROK','CGNX','SERV']),
}

export function usThemesForStock(symbol) {
  const ticker = String(symbol || '').toUpperCase()
  const result = []
  for (const [theme, symbols] of Object.entries(CATALOG)) {
    if (symbols.has(ticker)) result.push(theme)
  }
  return result
}

export function buildUsThemeGroups(rankings, { limit = 50, minMembers = 3, maxThemes = 10 } = {}) {
  const groups = new Map()
  for (const item of rankings.slice(0, limit)) {
    if (!item?.symbol) continue
    for (const theme of usThemesForStock(item.symbol)) {
      const group = groups.get(theme) ?? { name: theme, members: [], tradingAmount: 0 }
      if (!group.members.some((member) => member.symbol === item.symbol)) {
        group.members.push(item)
        group.tradingAmount += Number(item.tradingAmount) || 0
      }
      groups.set(theme, group)
    }
  }

  return [...groups.values()]
    .filter((group) => group.members.length >= minMembers)
    .sort((a, b) => b.tradingAmount - a.tradingAmount)
    .slice(0, maxThemes)
}

export function selectUsThemeGroups(rankings, { targetCount = 5, limit = 50 } = {}) {
  const universe = rankings.slice(0, limit)
  const selected = []
  const seen = new Set()
  const tiers = [
    { minMembers: 3, basis: 'TOP50 3종+' },
    { minMembers: 2, basis: 'TOP50 2종 보강' },
    { minMembers: 1, basis: 'TOP50 1종 보강' },
  ]

  for (const tier of tiers) {
    const candidates = buildUsThemeGroups(universe, {
      limit: universe.length,
      minMembers: tier.minMembers,
      maxThemes: 64,
    })
    for (const group of candidates) {
      if (seen.has(group.name)) continue
      seen.add(group.name)
      selected.push({ ...group, selectionBasis: tier.basis, rankingLimit: 50 })
      if (selected.length >= targetCount) return selected
    }
  }

  return selected
}
