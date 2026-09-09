import { readFileSync } from 'node:fs'

const catalogPath = process.env.THEME_CATALOG_PATH || new URL('./data/themes.kr.json', import.meta.url)
const rawCatalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
const THEMES = rawCatalog?.themes ?? {}
const CATALOG = Object.fromEntries(Object.entries(THEMES).map(([theme, config]) => [theme, new Set(config?.symbols ?? [])]))
const KEYWORDS = Object.entries(THEMES).map(([theme, config]) => [theme, config?.keywords ?? []])

export const themeCatalogMetadata = {
  version: rawCatalog?.version ?? 1,
  updatedAt: rawCatalog?.updatedAt ?? null,
  policy: rawCatalog?.policy ?? null,
  themeCount: Object.keys(THEMES).length,
}

export function themesForStock(symbol, name = '') {
  const result = new Set()
  for (const [theme, symbols] of Object.entries(CATALOG)) {
    if (symbols.has(symbol)) result.add(theme)
  }
  const normalized = String(name || '').replace(/\s+/g, '').toUpperCase()
  for (const [theme, words] of KEYWORDS) {
    if (words.some((word) => normalized.includes(String(word).replace(/\s+/g, '').toUpperCase()))) result.add(theme)
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
