const CATALOG = {
  '반도체': new Set(['005930','000660','042700','000990','058470','039030','036930','108490','095340','322310','005290','067310','240810','403870','357780','084370','319660','131970','348210','183300','098460','079370','054450','095610','140860','101490','089030']),
  '원전': new Set(['034020','052690','051600','298040','267260','103590','010120','001440','006260','015760','071970','083650','046120','126720']),
  '전력기기': new Set(['267260','298040','103590','010120','001440','006260','051600','015760','071970']),
  '방산': new Set(['012450','079550','047810','064350','272210','462870','103140','042660','005870','003570']),
  '조선': new Set(['042660','009540','329180','010140','267250','097230','443060']),
  '2차전지': new Set(['373220','006400','247540','086520','003670','051910','066970','020150','278280','361610','005490','011790']),
  '바이오': new Set(['196170','298380','068270','207940','145020','326030','141080','000100','128940','214450','028300','095700','068760','237690','347850']),
  '인터넷·게임': new Set(['035420','035720','259960','251270','036570','293490','263750','112040','078340']),
  '자동차': new Set(['005380','000270','012330','161390','011210','018880','204320','086280','009150']),
  '금융': new Set(['105560','055550','086790','316140','138930','024110','032830','000810','005830','071050']),
  '로봇': new Set(['277810','454910','108490','090360','056080','140670','348340','117730']),
}

const KEYWORDS = [
  ['반도체', ['반도체','하이닉스','DB하이텍','한미반도체','HPSP','테크윙','리노공업']],
  ['원전', ['원전','에너빌리티','한전기술','우진','비에이치아이']],
  ['전력기기', ['전력','일렉트릭','효성중공업','LS ELECTRIC','대한전선','가온전선']],
  ['방산', ['에어로스페이스','LIG넥스원','현대로템','한국항공우주','스페이스']],
  ['조선', ['조선','오션','중공업']],
  ['2차전지', ['에너지솔루션','삼성SDI','에코프로','포스코퓨처엠','엘앤에프']],
  ['바이오', ['바이오','셀트리온','알테오젠','리가켐','유한양행']],
  ['인터넷·게임', ['NAVER','카카오','크래프톤','엔씨소프트','넷마블']],
  ['자동차', ['현대차','기아','모비스','HL만도']],
  ['금융', ['금융','은행','지주','생명','화재']],
  ['로봇', ['로봇','레인보우로보틱스','두산로보틱스']],
]

export function themesForStock(symbol, name = '') {
  const result = new Set()
  for (const [theme, symbols] of Object.entries(CATALOG)) {
    if (symbols.has(symbol)) result.add(theme)
  }
  const normalized = String(name || '').replace(/\s+/g, '').toUpperCase()
  for (const [theme, words] of KEYWORDS) {
    if (words.some((word) => normalized.includes(word.replace(/\s+/g, '').toUpperCase()))) result.add(theme)
  }
  return [...result]
}

export function buildThemeGroups(rankings, { limit = 50, minMembers = 3, maxThemes = 7 } = {}) {
  const groups = new Map()
  for (const item of rankings.slice(0, limit)) {
    if (!item?.symbol) continue
    for (const theme of themesForStock(item.symbol, item.name)) {
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
