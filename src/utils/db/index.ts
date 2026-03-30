import type { IChapterRecord, IReviewRecord, IWordRecord, LetterMistakes } from './record'
import { ChapterRecord, WordRecord } from './record'
import { TypingContext, TypingStateActionType } from '@/pages/Typing/store'
import type { TypingState } from '@/pages/Typing/store/type'
import { currentChapterAtom, currentDictIdAtom, isReviewModeAtom } from '@/store'
import { useAtomValue } from 'jotai'
import { useCallback, useContext } from 'react'

const API_PREFIX = '/api'

async function requestJSON<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init)
  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `Request failed with status ${response.status}`)
  }
  return (await response.json()) as T
}

function shallowMatch<T extends object>(item: T, matcher: Partial<T>) {
  return Object.entries(matcher).every(([key, value]) => (item as Record<string, unknown>)[key] === value)
}

class QueryChain<T extends object> {
  private predicates: Array<(item: T) => boolean>

  constructor(
    private readonly tableName: 'wordRecords' | 'chapterRecords' | 'reviewRecords',
    private readonly loader: () => Promise<T[]>,
    predicates: Array<(item: T) => boolean> = [],
  ) {
    this.predicates = predicates
  }

  private withPredicate(predicate: (item: T) => boolean) {
    return new QueryChain<T>(this.tableName, this.loader, [...this.predicates, predicate])
  }

  equals(value: unknown) {
    const field = (this as unknown as { currentField?: string }).currentField
    if (!field) {
      throw new Error('equals() can only be called after where(field)')
    }
    return this.withPredicate((item) => (item as Record<string, unknown>)[field] === value)
  }

  above(value: number) {
    const field = (this as unknown as { currentField?: string }).currentField
    if (!field) {
      throw new Error('above() can only be called after where(field)')
    }
    return this.withPredicate((item) => Number((item as Record<string, unknown>)[field]) > value)
  }

  between(start: number, end: number) {
    const field = (this as unknown as { currentField?: string }).currentField
    if (!field) {
      throw new Error('between() can only be called after where(field)')
    }
    return this.withPredicate((item) => {
      const value = Number((item as Record<string, unknown>)[field])
      return value >= start && value <= end
    })
  }

  and(predicate: (item: T) => boolean) {
    return this.withPredicate(predicate)
  }

  filter(predicate: (item: T) => boolean) {
    return this.withPredicate(predicate)
  }

  async toArray(): Promise<T[]> {
    const rows = await this.loader()
    return this.predicates.reduce((acc, predicate) => acc.filter(predicate), rows)
  }

  async delete() {
    // Only the error-book delete path is needed now: where({ word, dict }).delete()
    const rows = await this.toArray()
    if (this.tableName !== 'wordRecords') {
      throw new Error('delete() is only supported for word records')
    }
    let deleted = 0
    for (const row of rows as Array<T & { word?: string; dict?: string }>) {
      if (!row.word || !row.dict) continue
      const result = await requestJSON<{ deletedCount: number }>(
        `${API_PREFIX}/word-records?word=${encodeURIComponent(row.word)}&dict=${encodeURIComponent(row.dict)}`,
        { method: 'DELETE' },
      )
      deleted += result.deletedCount
    }
    return deleted
  }
}

type TableRecordMap = {
  wordRecords: IWordRecord & { id?: number }
  chapterRecords: IChapterRecord & { id?: number }
  reviewRecords: IReviewRecord & { id?: number }
}

class TableAdapter<K extends keyof TableRecordMap> {
  constructor(private readonly tableName: K) {}

  mapToClass() {
    return
  }

  private async getAllRows() {
    switch (this.tableName) {
      case 'wordRecords':
        return await requestJSON<TableRecordMap[K][]>(`${API_PREFIX}/word-records`)
      case 'chapterRecords':
        return await requestJSON<TableRecordMap[K][]>(`${API_PREFIX}/chapter-records`)
      case 'reviewRecords':
        return await requestJSON<TableRecordMap[K][]>(`${API_PREFIX}/review-records`)
      default:
        return []
    }
  }

  where(field: string): QueryChain<TableRecordMap[K]>
  where(filterObj: Partial<TableRecordMap[K]>): QueryChain<TableRecordMap[K]>
  where(input: string | Partial<TableRecordMap[K]>) {
    if (typeof input === 'string') {
      const chain = new QueryChain<TableRecordMap[K]>(this.tableName as 'wordRecords' | 'chapterRecords' | 'reviewRecords', () =>
        this.getAllRows(),
      ) as QueryChain<TableRecordMap[K]> & { currentField?: string }
      chain.currentField = input
      return chain
    }
    return new QueryChain<TableRecordMap[K]>(
      this.tableName as 'wordRecords' | 'chapterRecords' | 'reviewRecords',
      () => this.getAllRows(),
      [(item) => shallowMatch(item as object, input as object)],
    )
  }

  async add(record: TableRecordMap[K]) {
    switch (this.tableName) {
      case 'wordRecords': {
        const result = await requestJSON<{ id: number }>(`${API_PREFIX}/word-records`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(record),
        })
        return result.id
      }
      case 'chapterRecords': {
        const result = await requestJSON<{ id: number }>(`${API_PREFIX}/chapter-records`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(record),
        })
        return result.id
      }
      case 'reviewRecords': {
        const result = await requestJSON<{ id: number }>(`${API_PREFIX}/review-records`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(record),
        })
        return result.id
      }
      default:
        return -1
    }
  }

  async put(record: TableRecordMap[K]) {
    if (this.tableName !== 'reviewRecords') {
      return this.add(record)
    }
    const result = await requestJSON<{ id: number }>(`${API_PREFIX}/review-records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    })
    return result.id
  }

  async count() {
    switch (this.tableName) {
      case 'wordRecords': {
        const result = await requestJSON<{ count: number }>(`${API_PREFIX}/word-records/count`)
        return result.count
      }
      case 'chapterRecords': {
        const result = await requestJSON<{ count: number }>(`${API_PREFIX}/chapter-records/count`)
        return result.count
      }
      default: {
        const rows = await this.getAllRows()
        return rows.length
      }
    }
  }

  orderBy(field: keyof TableRecordMap[K]) {
    return {
      first: async () => {
        const rows = await this.getAllRows()
        const sorted = [...rows].sort((a, b) => Number(a[field] ?? 0) - Number(b[field] ?? 0))
        return sorted[0]
      },
    }
  }

  async each(callback: (record: TableRecordMap[K]) => void) {
    const rows = await this.getAllRows()
    rows.forEach(callback)
  }
}

export const db = {
  wordRecords: new TableAdapter('wordRecords'),
  chapterRecords: new TableAdapter('chapterRecords'),
  reviewRecords: new TableAdapter('reviewRecords'),
}

export function useSaveChapterRecord() {
  const currentChapter = useAtomValue(currentChapterAtom)
  const isRevision = useAtomValue(isReviewModeAtom)
  const dictID = useAtomValue(currentDictIdAtom)

  const saveChapterRecord = useCallback(
    (typingState: TypingState) => {
      const {
        chapterData: { correctCount, wrongCount, userInputLogs, wordCount, words, wordRecordIds },
        timerData: { time },
      } = typingState
      const correctWordIndexes = userInputLogs.filter((log) => log.correctCount > 0 && log.wrongCount === 0).map((log) => log.index)

      const chapterRecord = new ChapterRecord(
        dictID,
        isRevision ? -1 : currentChapter,
        time,
        correctCount,
        wrongCount,
        wordCount,
        correctWordIndexes,
        words.length,
        wordRecordIds ?? [],
      )
      void db.chapterRecords.add(chapterRecord)
    },
    [currentChapter, dictID, isRevision],
  )

  return saveChapterRecord
}

export type WordKeyLogger = {
  letterTimeArray: number[]
  letterMistake: LetterMistakes
}

export function useSaveWordRecord() {
  const isRevision = useAtomValue(isReviewModeAtom)
  const currentChapter = useAtomValue(currentChapterAtom)
  const dictID = useAtomValue(currentDictIdAtom)

  const { dispatch } = useContext(TypingContext) ?? {}

  const saveWordRecord = useCallback(
    async ({
      word,
      wrongCount,
      letterTimeArray,
      letterMistake,
    }: {
      word: string
      wrongCount: number
      letterTimeArray: number[]
      letterMistake: LetterMistakes
    }) => {
      const timing = []
      for (let i = 1; i < letterTimeArray.length; i++) {
        const diff = letterTimeArray[i] - letterTimeArray[i - 1]
        timing.push(diff)
      }

      const wordRecord = new WordRecord(word, dictID, isRevision ? -1 : currentChapter, timing, wrongCount, letterMistake)

      let dbID = -1
      try {
        dbID = await db.wordRecords.add(wordRecord)
      } catch (e) {
        console.error(e)
      }
      if (dispatch) {
        dbID > 0 && dispatch({ type: TypingStateActionType.ADD_WORD_RECORD_ID, payload: dbID })
        dispatch({ type: TypingStateActionType.SET_IS_SAVING_RECORD, payload: false })
      }
    },
    [currentChapter, dictID, dispatch, isRevision],
  )

  return saveWordRecord
}

export function useDeleteWordRecord() {
  const deleteWordRecord = useCallback(async (word: string, dict: string) => {
    try {
      const deletedCount = await db.wordRecords.where({ word, dict }).delete()
      return deletedCount
    } catch (error) {
      console.error(`删除单词记录时出错：`, error)
    }
  }, [])

  return { deleteWordRecord }
}
