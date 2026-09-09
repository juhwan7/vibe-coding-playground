import { readFileSync, statSync } from 'node:fs'

const DESCRIPTION_CACHE_PATH = process.env.QUIZ_DESCRIPTION_CACHE_PATH || '/app/data/quiz-descriptions.json'
const CACHE_RECHECK_MS = 60_000

const SYMBOL_OVERRIDES = new Map([
  ['005935', '반도체'], // 삼성전자우: 보통주 기업개요를 공유하지만 테마 카탈로그 코드는 별도다.
  ['009150', '전자·IT부품'], // 삼성전기
  ['402340', '지주·투자'], // SK스퀘어
  ['000120', '운송·물류'], // CJ대한통운
])

const CLASSIFICATION_RULES = [
  ['반도체', /(반도체|HBM|DRAM|NAND|웨이퍼|팹리스|파운드리|패키징|후공정|전공정|포토레지스트|실리콘카바이드|SiC)/i],
  ['2차전지', /(2차전지|이차전지|배터리|양극재|음극재|분리막|전해질|리튬이온|배터리셀|배터리 소재)/i],
  ['바이오·제약', /(바이오|제약|의약품|신약|항체|임상|의료기기|진단기기|진단시약|헬스케어|의료장비|의약외품)/i],
  ['자동차', /(자동차|완성차|자동차부품|차량용|전기차|모빌리티|타이어|파워트레인|전장부품)/i],
  ['로봇·자동화', /(로봇|로보틱스|감속기|스마트팩토리|공장자동화|자동화 장비|자동화장비)/i],
  ['인터넷·플랫폼', /(인터넷|검색 포털|검색포털|온라인 플랫폼|온라인플랫폼|커머스 플랫폼|핀테크 플랫폼|포털 서비스|포털서비스)/i],
  ['게임', /(게임 개발|게임개발|게임 서비스|게임서비스|온라인게임|모바일게임|게임 소프트웨어)/i],
  ['조선·해양', /(조선|선박|해양플랜트|해양 플랜트|LNG선|LNG 운반선|선박엔진|선박 기자재|선박기자재)/i],
  ['원전', /(원자력|원전|원자로|SMR|소형모듈원자로|핵연료)/i],
  ['전력·전기', /(전력기기|전력 기기|변압기|송배전|배전반|전선|전력케이블|전력 케이블|전력망|전력설비|전기장비|전기 장비)/i],
  ['방산·항공우주', /(방산|방위산업|항공우주|항공기|유도무기|군수|미사일|레이더|우주항공|위성체)/i],
  ['금융', /(금융지주|은행|증권업|증권사|손해보험|생명보험|보험업|카드사|여신전문|자산운용|금융업)/i],
  ['통신·네트워크', /(이동통신|통신서비스|통신 서비스|네트워크 장비|네트워크장비|광통신|광케이블|통신장비|통신 장비|기지국)/i],
  ['건설·인프라', /(건설업|건축공사|토목공사|주택사업|주택 사업|플랜트 건설|플랜트건설|건설사업|사회기반시설|SOC 사업|SOC사업)/i],
  ['에너지·정유', /(정유|석유제품|석유 제품|원유|LNG|도시가스|에너지 사업|에너지사업|발전사업|발전 사업)/i],
  ['화학·소재', /(석유화학|화학제품|화학 제품|합성수지|합성고무|정밀화학|화학소재|화학 소재|첨단소재|첨단 소재|산업소재|산업 소재)/i],
  ['철강·금속', /(철강|강판|강관|특수강|스테인리스|비철금속|알루미늄|동박|금속제품|금속 제품)/i],
  ['디스플레이', /(디스플레이|OLED|LCD|마이크로LED|마이크로 LED|패널 장비|패널장비)/i],
  ['전자·IT부품', /(전자부품|전자 부품|PCB|인쇄회로기판|MLCC|카메라모듈|카메라 모듈|스마트폰 부품|스마트폰부품|IT부품|IT 부품|센서 모듈|센서모듈)/i],
  ['소프트웨어·IT서비스', /(소프트웨어|IT서비스|IT 서비스|클라우드|시스템통합|시스템 통합|SI 사업|SI사업|데이터센터|데이터 센터|보안솔루션|보안 솔루션)/i],
  ['기계·장비', /(산업기계|산업 기계|공작기계|공작 기계|기계장비|기계 장비|산업장비|산업 장비|건설기계|건설 기계|펌프|압축기)/i],
  ['운송·물류', /(물류|택배|해운|항공운송|항공 운송|육상운송|육상 운송|운송사업|운송 사업|창고업|항만)/i],
  ['엔터·콘텐츠', /(엔터테인먼트|음원|음반|아티스트|매니지먼트|콘텐츠 제작|콘텐츠제작|드라마 제작|영화 제작|웹툰|웹소설)/i],
  ['미디어·광고', /(방송사업|방송 사업|광고대행|광고 대행|미디어렙|미디어 사업|미디어사업|신문|방송채널)/i],
  ['유통·소비재', /(유통업|백화점|대형마트|편의점|면세점|홈쇼핑|화장품|생활용품|의류|패션|소비재)/i],
  ['음식료', /(식품|음료|주류|제과|제빵|사료|식자재|외식사업|외식 사업)/i],
  ['지주·투자', /(지주회사|지주 회사|투자회사|투자 회사|투자사업|투자 사업|자회사 지분|자회사 관리)/i],
  ['신재생·환경', /(태양광|풍력|수소에너지|수소 에너지|연료전지|신재생|재생에너지|폐기물|환경사업|환경 사업|수처리)/i],
  ['교육', /(교육서비스|교육 서비스|학원|교재|온라인교육|온라인 교육|에듀테크)/i],
]

let cachedDescriptions = new Map()
let cachedMtimeMs = -1
let nextCacheCheckAt = 0

function normalize(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function refreshDescriptionCache() {
  const now = Date.now()
  if (now < nextCacheCheckAt) return
  nextCacheCheckAt = now + CACHE_RECHECK_MS

  try {
    const stat = statSync(DESCRIPTION_CACHE_PATH)
    if (stat.mtimeMs === cachedMtimeMs) return
    const payload = JSON.parse(readFileSync(DESCRIPTION_CACHE_PATH, 'utf8'))
    const next = new Map()
    for (const [code, item] of Object.entries(payload?.items ?? {})) {
      const description = normalize(item?.description)
      if (/^\d{6}$/.test(code) && description) next.set(code, description)
    }
    cachedDescriptions = next
    cachedMtimeMs = stat.mtimeMs
  } catch {
    // 첫 실행이나 기업개요 캐시 준비 전에는 종목명 기반 분류만 사용한다.
  }
}

export function cachedDescriptionForStock(symbol) {
  refreshDescriptionCache()
  return cachedDescriptions.get(String(symbol ?? '').trim()) ?? null
}

export function classifyStockSector({ symbol, name, description } = {}) {
  const code = String(symbol ?? '').trim()
  const overridden = SYMBOL_OVERRIDES.get(code)
  if (overridden) return { label: overridden, source: 'symbol-override' }

  const companyName = normalize(name)
  const companyDescription = normalize(description)
  const haystack = `${companyName} ${companyDescription}`.trim()

  for (const [label, pattern] of CLASSIFICATION_RULES) {
    if (pattern.test(haystack)) return { label, source: companyDescription ? 'company-overview' : 'stock-name' }
  }

  const nameFallbacks = [
    ['건설·인프라', /(건설|엔지니어링)$/i],
    ['바이오·제약', /(바이오|제약|약품|메디|메디칼)/i],
    ['로봇·자동화', /(로봇|로보)/i],
    ['전력·전기', /(전선|전기|일렉트릭)/i],
    ['금융', /(금융|증권|보험|생명|화재|캐피탈)$/i],
    ['조선·해양', /(조선|오션|중공업)$/i],
    ['전자·IT부품', /(전자|테크|테크놀로지)/i],
    ['화학·소재', /(화학|케미칼|소재)$/i],
    ['철강·금속', /(철강|금속|스틸)$/i],
    ['엔터·콘텐츠', /(엔터|스튜디오|콘텐츠)/i],
  ]
  for (const [label, pattern] of nameFallbacks) {
    if (pattern.test(companyName)) return { label, source: 'stock-name' }
  }

  return { label: '기타·개별주', source: 'fallback' }
}
