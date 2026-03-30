const fs = require('fs')
const path = require('path')

const dictDir = path.resolve(process.cwd(), 'public/dicts')

const POS_PREFIX_RE = /^(adj|adv|n|v|vt|vi|aux|art|num|pron|prep|conj|int|phr|pl|modal)(?:\/(adj|adv|n|v|vt|vi|aux|art|num|pron|prep|conj|int|phr|pl|modal))?\.\s*/i

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasPosPrefix(trans) {
  return POS_PREFIX_RE.test(trans.trim())
}

function normalizedPosPrefix(trans) {
  const match = trans.trim().match(POS_PREFIX_RE)
  if (!match) return null
  return `${match[0].trim().replace(/\s+$/, '')} `
}

function ensureUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8')
}

const files = fs
  .readdirSync(dictDir)
  .filter((file) => file.endsWith('.json'))
  .map((file) => path.join(dictDir, file))

const wordPosMap = new Map()

for (const filePath of files) {
  let parsed
  try {
    parsed = JSON.parse(ensureUtf8(filePath))
  } catch {
    continue
  }
  if (!Array.isArray(parsed)) continue
  for (const item of parsed) {
    if (!isObject(item)) continue
    if (typeof item.name !== 'string' || !Array.isArray(item.trans)) continue
    const word = item.name.trim().toLowerCase()
    if (!word) continue
    for (const trans of item.trans) {
      if (typeof trans !== 'string') continue
      const pos = normalizedPosPrefix(trans)
      if (!pos) continue
      const countMap = wordPosMap.get(word) ?? new Map()
      countMap.set(pos, (countMap.get(pos) ?? 0) + 1)
      wordPosMap.set(word, countMap)
    }
  }
}

function pickMostFrequentPos(word) {
  const countMap = wordPosMap.get(word)
  if (!countMap) return null
  let bestPos = null
  let bestCount = -1
  for (const [pos, count] of countMap.entries()) {
    if (count > bestCount) {
      bestPos = pos
      bestCount = count
    }
  }
  return bestPos
}

let changedFiles = 0
let changedItems = 0
let changedTrans = 0

for (const filePath of files) {
  let parsed
  try {
    parsed = JSON.parse(ensureUtf8(filePath))
  } catch {
    continue
  }
  if (!Array.isArray(parsed)) continue

  let fileChanged = false

  for (const item of parsed) {
    if (!isObject(item)) continue
    if (typeof item.name !== 'string' || !Array.isArray(item.trans)) continue

    const word = item.name.trim().toLowerCase()
    if (!word) continue
    const bestPos = pickMostFrequentPos(word)
    if (!bestPos) continue

    let itemChanged = false
    const nextTrans = item.trans.map((trans) => {
      if (typeof trans !== 'string') return trans
      const trimmed = trans.trim()
      if (!trimmed || hasPosPrefix(trimmed)) return trans
      itemChanged = true
      changedTrans += 1
      return `${bestPos}${trimmed}`
    })

    if (itemChanged) {
      item.trans = nextTrans
      fileChanged = true
      changedItems += 1
    }
  }

  if (fileChanged) {
    changedFiles += 1
    fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2) + '\n', 'utf8')
  }
}

console.log(
  JSON.stringify({
    changedFiles,
    changedItems,
    changedTrans,
  }),
)
