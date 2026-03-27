import type { IChapterRecord, IReviewRecord, IWordRecord } from './record'
import type Dexie from 'dexie'
import type { Table } from 'dexie'
import initSqlJs from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'

type LocalSqliteSyncState = {
  supported: boolean
  initialized: boolean
  bound: boolean
  fileName: string | null
  syncing: boolean
  lastSyncedAt: number | null
  lastError: string | null
}

type WordRecordRow = IWordRecord & { id: number }
type ChapterRecordRow = IChapterRecord & { id: number }
type ReviewRecordRow = IReviewRecord & { id: number }
type LocalFileListener = (state: LocalSqliteSyncState) => void

const META_DB_NAME = 'qwerty-learner-local-file-meta'
const META_STORE_NAME = 'meta'
const HANDLE_KEY = 'sqlite-file-handle'
const SQLITE_FILE_NAME = 'qwerty-learner.sqlite'

let sqlJsFactoryPromise: Promise<any> | null = null
let boundHandle: any | null = null
let syncTimer: number | undefined
let isSyncInProgress = false
let hasInitialized = false

const listeners = new Set<LocalFileListener>()
let syncState: LocalSqliteSyncState = {
  supported: false,
  initialized: false,
  bound: false,
  fileName: null,
  syncing: false,
  lastSyncedAt: null,
  lastError: null,
}

function isSupportedRuntime() {
  const runtime = window as Window & {
    showSaveFilePicker?: (options: unknown) => Promise<unknown>
  }
  return Boolean(runtime.showSaveFilePicker && window.indexedDB)
}

function updateState(partial: Partial<LocalSqliteSyncState>) {
  syncState = { ...syncState, ...partial }
  listeners.forEach((listener) => {
    listener(syncState)
  })
}

export function getLocalSqliteSyncState() {
  return syncState
}

export function subscribeLocalSqliteSyncState(listener: LocalFileListener) {
  listeners.add(listener)
  listener(syncState)
  return () => {
    listeners.delete(listener)
  }
}

function getSqlJsFactory() {
  if (!sqlJsFactoryPromise) {
    sqlJsFactoryPromise = initSqlJs({
      locateFile: () => wasmUrl,
    })
  }
  return sqlJsFactoryPromise
}

function openMetaDB() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(META_DB_NAME, 1)
    request.onerror = () => reject(request.error)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(META_STORE_NAME)) {
        db.createObjectStore(META_STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
  })
}

async function getStoredHandle() {
  const db = await openMetaDB()
  try {
    return await new Promise<any | undefined>((resolve, reject) => {
      const tx = db.transaction(META_STORE_NAME, 'readonly')
      const store = tx.objectStore(META_STORE_NAME)
      const request = store.get(HANDLE_KEY)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result as any)
    })
  } finally {
    db.close()
  }
}

async function setStoredHandle(handle: unknown) {
  const db = await openMetaDB()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(META_STORE_NAME, 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.objectStore(META_STORE_NAME).put(handle, HANDLE_KEY)
    })
  } finally {
    db.close()
  }
}

async function clearStoredHandle() {
  const db = await openMetaDB()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(META_STORE_NAME, 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.objectStore(META_STORE_NAME).delete(HANDLE_KEY)
    })
  } finally {
    db.close()
  }
}

async function ensureHandlePermission(handle: any, shouldRequest: boolean) {
  if (!handle) {
    return false
  }

  if (typeof handle.queryPermission === 'function') {
    const permission = await handle.queryPermission({ mode: 'readwrite' })
    if (permission === 'granted') {
      return true
    }
  }

  if (!shouldRequest || typeof handle.requestPermission !== 'function') {
    return false
  }

  const permission = await handle.requestPermission({ mode: 'readwrite' })
  return permission === 'granted'
}

async function readHandleBytes(handle: any) {
  const file = await handle.getFile()
  const buffer = await file.arrayBuffer()
  return new Uint8Array(buffer)
}

async function writeHandleBytes(handle: any, bytes: Uint8Array) {
  const writable = await handle.createWritable()
  await writable.write(bytes)
  await writable.close()
}

function ensureSchema(sqliteDb: any) {
  sqliteDb.run(`
    CREATE TABLE IF NOT EXISTS word_records (
      id INTEGER PRIMARY KEY,
      word TEXT NOT NULL,
      time_stamp INTEGER NOT NULL,
      dict TEXT NOT NULL,
      chapter INTEGER,
      timing_json TEXT NOT NULL,
      wrong_count INTEGER NOT NULL,
      mistakes_json TEXT NOT NULL
    );
  `)

  sqliteDb.run(`
    CREATE TABLE IF NOT EXISTS chapter_records (
      id INTEGER PRIMARY KEY,
      dict TEXT NOT NULL,
      chapter INTEGER,
      time_stamp INTEGER NOT NULL,
      time INTEGER NOT NULL,
      correct_count INTEGER NOT NULL,
      wrong_count INTEGER NOT NULL,
      word_count INTEGER NOT NULL,
      correct_word_indexes_json TEXT NOT NULL,
      word_number INTEGER NOT NULL,
      word_record_ids_json TEXT NOT NULL
    );
  `)

  sqliteDb.run(`
    CREATE TABLE IF NOT EXISTS review_records (
      id INTEGER PRIMARY KEY,
      dict TEXT NOT NULL,
      idx INTEGER NOT NULL,
      create_time INTEGER NOT NULL,
      is_finished INTEGER NOT NULL,
      words_json TEXT NOT NULL
    );
  `)
}

function mapQueryRows(sqliteDb: any, query: string) {
  const result = sqliteDb.exec(query)
  if (!result.length) {
    return []
  }
  const first = result[0]
  const { columns, values } = first
  return values.map((row: unknown[]) => {
    const entry = row.map((value, index) => [columns[index], value])
    return Object.fromEntries(entry)
  })
}

async function collectRowsWithIds<T extends object>(table: Table<T, number>) {
  const [rows, ids] = await Promise.all([table.toArray(), table.toCollection().primaryKeys()])
  return rows.map((row, index) => ({
    ...row,
    id: Number(ids[index]),
  }))
}

function hasSQLiteData(sqliteDb: any) {
  const result = sqliteDb.exec(
    'SELECT (SELECT COUNT(*) FROM word_records) + (SELECT COUNT(*) FROM chapter_records) + (SELECT COUNT(*) FROM review_records) AS total',
  )
  const total = Number(result?.[0]?.values?.[0]?.[0] ?? 0)
  return total > 0
}

async function writeDexieSnapshotToSQLite(db: Dexie, sqliteDb: any) {
  const [wordRows, chapterRows, reviewRows] = await Promise.all([
    collectRowsWithIds(db.table('wordRecords')),
    collectRowsWithIds(db.table('chapterRecords')),
    collectRowsWithIds(db.table('reviewRecords')),
  ])

  sqliteDb.run('BEGIN TRANSACTION;')
  try {
    sqliteDb.run('DELETE FROM word_records;')
    sqliteDb.run('DELETE FROM chapter_records;')
    sqliteDb.run('DELETE FROM review_records;')

    const insertWord = sqliteDb.prepare(
      'INSERT INTO word_records (id, word, time_stamp, dict, chapter, timing_json, wrong_count, mistakes_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
    )
    for (const row of wordRows as WordRecordRow[]) {
      insertWord.run([
        row.id,
        row.word,
        row.timeStamp,
        row.dict,
        row.chapter,
        JSON.stringify(row.timing ?? []),
        row.wrongCount,
        JSON.stringify(row.mistakes ?? {}),
      ])
    }
    insertWord.free()

    const insertChapter = sqliteDb.prepare(
      'INSERT INTO chapter_records (id, dict, chapter, time_stamp, time, correct_count, wrong_count, word_count, correct_word_indexes_json, word_number, word_record_ids_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);',
    )
    for (const row of chapterRows as ChapterRecordRow[]) {
      insertChapter.run([
        row.id,
        row.dict,
        row.chapter,
        row.timeStamp,
        row.time,
        row.correctCount,
        row.wrongCount,
        row.wordCount,
        JSON.stringify(row.correctWordIndexes ?? []),
        row.wordNumber,
        JSON.stringify(row.wordRecordIds ?? []),
      ])
    }
    insertChapter.free()

    const insertReview = sqliteDb.prepare(
      'INSERT INTO review_records (id, dict, idx, create_time, is_finished, words_json) VALUES (?, ?, ?, ?, ?, ?);',
    )
    for (const row of reviewRows as ReviewRecordRow[]) {
      insertReview.run([row.id, row.dict, row.index, row.createTime, row.isFinished ? 1 : 0, JSON.stringify(row.words ?? [])])
    }
    insertReview.free()

    sqliteDb.run('COMMIT;')
  } catch (error) {
    sqliteDb.run('ROLLBACK;')
    throw error
  }
}

function parseJSONArray(value: unknown) {
  if (typeof value !== 'string') {
    return []
  }
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function parseJSONObject(value: unknown) {
  if (typeof value !== 'string') {
    return {}
  }
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function hydrateDexieFromSQLite(db: Dexie, sqliteDb: any) {
  const wordRows = mapQueryRows(
    sqliteDb,
    'SELECT id, word, time_stamp, dict, chapter, timing_json, wrong_count, mistakes_json FROM word_records ORDER BY id ASC;',
  )
  const chapterRows = mapQueryRows(
    sqliteDb,
    'SELECT id, dict, chapter, time_stamp, time, correct_count, wrong_count, word_count, correct_word_indexes_json, word_number, word_record_ids_json FROM chapter_records ORDER BY id ASC;',
  )
  const reviewRows = mapQueryRows(
    sqliteDb,
    'SELECT id, dict, idx, create_time, is_finished, words_json FROM review_records ORDER BY id ASC;',
  )

  await db.transaction('rw', db.table('wordRecords'), db.table('chapterRecords'), db.table('reviewRecords'), async () => {
    await db.table('wordRecords').clear()
    await db.table('chapterRecords').clear()
    await db.table('reviewRecords').clear()

    if (wordRows.length > 0) {
      await db.table('wordRecords').bulkPut(
        wordRows.map((row: Record<string, unknown>) => ({
          id: Number(row.id),
          word: row.word,
          timeStamp: Number(row.time_stamp),
          dict: row.dict,
          chapter: row.chapter === null ? null : Number(row.chapter),
          timing: parseJSONArray(row.timing_json),
          wrongCount: Number(row.wrong_count),
          mistakes: parseJSONObject(row.mistakes_json),
        })),
      )
    }

    if (chapterRows.length > 0) {
      await db.table('chapterRecords').bulkPut(
        chapterRows.map((row: Record<string, unknown>) => ({
          id: Number(row.id),
          dict: row.dict,
          chapter: row.chapter === null ? null : Number(row.chapter),
          timeStamp: Number(row.time_stamp),
          time: Number(row.time),
          correctCount: Number(row.correct_count),
          wrongCount: Number(row.wrong_count),
          wordCount: Number(row.word_count),
          correctWordIndexes: parseJSONArray(row.correct_word_indexes_json).map((item) => Number(item)),
          wordNumber: Number(row.word_number),
          wordRecordIds: parseJSONArray(row.word_record_ids_json).map((item) => Number(item)),
        })),
      )
    }

    if (reviewRows.length > 0) {
      await db.table('reviewRecords').bulkPut(
        reviewRows.map((row: Record<string, unknown>) => ({
          id: Number(row.id),
          dict: row.dict,
          index: Number(row.idx),
          createTime: Number(row.create_time),
          isFinished: Number(row.is_finished) === 1,
          words: parseJSONArray(row.words_json),
        })),
      )
    }
  })
}

async function writeDexieToHandle(db: Dexie, handle: any) {
  const SQL = await getSqlJsFactory()
  const sqliteDb = new SQL.Database()
  try {
    ensureSchema(sqliteDb)
    await writeDexieSnapshotToSQLite(db, sqliteDb)
    const bytes = sqliteDb.export()
    await writeHandleBytes(handle, bytes)
  } finally {
    sqliteDb.close()
  }
}

async function loadHandleIntoDexie(db: Dexie, handle: any) {
  const SQL = await getSqlJsFactory()
  const bytes = await readHandleBytes(handle)
  const sqliteDb = bytes.length ? new SQL.Database(bytes) : new SQL.Database()
  try {
    ensureSchema(sqliteDb)
    if (hasSQLiteData(sqliteDb)) {
      await hydrateDexieFromSQLite(db, sqliteDb)
    } else {
      await writeDexieSnapshotToSQLite(db, sqliteDb)
      const exportedBytes = sqliteDb.export()
      await writeHandleBytes(handle, exportedBytes)
    }
  } finally {
    sqliteDb.close()
  }
}

async function performSync(db: Dexie) {
  if (!boundHandle || isSyncInProgress) {
    return
  }

  isSyncInProgress = true
  updateState({ syncing: true, lastError: null })
  try {
    await writeDexieToHandle(db, boundHandle)
    updateState({ syncing: false, lastSyncedAt: Date.now() })
  } catch (error) {
    console.error('Failed to sync local sqlite file', error)
    updateState({
      syncing: false,
      lastError: error instanceof Error ? error.message : '本地文件同步失败',
    })
  } finally {
    isSyncInProgress = false
  }
}

export async function initializeLocalSqliteSync(db: Dexie) {
  if (hasInitialized) {
    return
  }
  hasInitialized = true

  const supported = isSupportedRuntime()
  updateState({ supported })
  if (!supported) {
    updateState({ initialized: true })
    return
  }

  try {
    const handle = await getStoredHandle()
    if (!handle) {
      updateState({ initialized: true })
      return
    }

    const hasPermission = await ensureHandlePermission(handle, false)
    if (!hasPermission) {
      updateState({
        initialized: true,
        bound: false,
        fileName: handle.name ?? null,
        lastError: '本地 SQLite 文件需要重新授权',
      })
      return
    }

    boundHandle = handle
    await loadHandleIntoDexie(db, handle)
    updateState({
      initialized: true,
      bound: true,
      fileName: handle.name ?? null,
      lastError: null,
      lastSyncedAt: Date.now(),
    })
  } catch (error) {
    console.error('Failed to initialize local sqlite sync', error)
    updateState({
      initialized: true,
      bound: false,
      fileName: null,
      lastError: error instanceof Error ? error.message : '初始化本地 SQLite 失败',
    })
  }
}

export async function bindLocalSqliteFile(db: Dexie) {
  if (!isSupportedRuntime()) {
    throw new Error('当前浏览器不支持本地文件写入')
  }

  const runtime = window as Window & {
    showSaveFilePicker?: (options: unknown) => Promise<unknown>
  }
  if (!runtime.showSaveFilePicker) {
    throw new Error('当前浏览器不支持本地文件选择器')
  }

  const handle = await runtime.showSaveFilePicker({
    suggestedName: SQLITE_FILE_NAME,
    types: [
      {
        description: 'SQLite Database',
        accept: { 'application/vnd.sqlite3': ['.sqlite', '.db'] },
      },
    ],
  })

  const hasPermission = await ensureHandlePermission(handle, true)
  if (!hasPermission) {
    throw new Error('未获得本地文件读写权限')
  }

  await loadHandleIntoDexie(db, handle)
  await setStoredHandle(handle)
  boundHandle = handle
  updateState({
    bound: true,
    fileName: (handle as { name?: string }).name ?? null,
    lastSyncedAt: Date.now(),
    lastError: null,
  })
}

export async function unbindLocalSqliteFile() {
  boundHandle = null
  if (syncTimer) {
    window.clearTimeout(syncTimer)
    syncTimer = undefined
  }
  await clearStoredHandle()
  updateState({
    bound: false,
    fileName: null,
    syncing: false,
    lastError: null,
  })
}

export async function flushLocalSqliteNow(db: Dexie) {
  await performSync(db)
}

export function notifyLocalSqliteDataChanged(db: Dexie) {
  if (!boundHandle) {
    return
  }
  if (syncTimer) {
    window.clearTimeout(syncTimer)
  }
  syncTimer = window.setTimeout(() => {
    void performSync(db)
  }, 600)
}
