const express = require('express')
const multer = require('multer')
const Database = require('better-sqlite3')
const fs = require('fs')
const path = require('path')

const app = express()
const PORT = Number(process.env.PORT || 3001)
const PROJECT_ROOT = process.cwd()
const SQLITE_PATH = path.resolve(PROJECT_ROOT, 'progress.sqlite')
const BUILD_DIR = path.resolve(PROJECT_ROOT, 'build')

app.use(express.json({ limit: '5mb' }))

const upload = multer({ storage: multer.memoryStorage() })

function ensureDir(filePath) {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function toJSON(value, fallback) {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

ensureDir(SQLITE_PATH)
const db = new Database(SQLITE_PATH)
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS word_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word TEXT NOT NULL,
    time_stamp INTEGER NOT NULL,
    dict TEXT NOT NULL,
    chapter INTEGER,
    timing_json TEXT NOT NULL,
    wrong_count INTEGER NOT NULL,
    mistakes_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chapter_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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

  CREATE TABLE IF NOT EXISTS review_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dict TEXT NOT NULL,
    idx INTEGER NOT NULL,
    create_time INTEGER NOT NULL,
    is_finished INTEGER NOT NULL,
    words_json TEXT NOT NULL
  );
`)

const getAllWordRecordsStmt = db.prepare(`
  SELECT id, word, time_stamp, dict, chapter, timing_json, wrong_count, mistakes_json
  FROM word_records
`)
const insertWordRecordStmt = db.prepare(`
  INSERT INTO word_records (word, time_stamp, dict, chapter, timing_json, wrong_count, mistakes_json)
  VALUES (@word, @timeStamp, @dict, @chapter, @timing_json, @wrongCount, @mistakes_json)
`)
const deleteWordRecordStmt = db.prepare('DELETE FROM word_records WHERE word = ? AND dict = ?')
const wordCountStmt = db.prepare('SELECT COUNT(*) AS count FROM word_records')

const getAllChapterRecordsStmt = db.prepare(`
  SELECT id, dict, chapter, time_stamp, time, correct_count, wrong_count, word_count, correct_word_indexes_json, word_number, word_record_ids_json
  FROM chapter_records
`)
const insertChapterRecordStmt = db.prepare(`
  INSERT INTO chapter_records (dict, chapter, time_stamp, time, correct_count, wrong_count, word_count, correct_word_indexes_json, word_number, word_record_ids_json)
  VALUES (@dict, @chapter, @timeStamp, @time, @correctCount, @wrongCount, @wordCount, @correct_word_indexes_json, @wordNumber, @word_record_ids_json)
`)
const chapterCountStmt = db.prepare('SELECT COUNT(*) AS count FROM chapter_records')

const getAllReviewRecordsStmt = db.prepare(`
  SELECT id, dict, idx, create_time, is_finished, words_json
  FROM review_records
`)
const insertReviewRecordStmt = db.prepare(`
  INSERT INTO review_records (dict, idx, create_time, is_finished, words_json)
  VALUES (@dict, @index, @createTime, @isFinished, @words_json)
`)
const updateReviewRecordStmt = db.prepare(`
  UPDATE review_records
  SET dict = @dict, idx = @index, create_time = @createTime, is_finished = @isFinished, words_json = @words_json
  WHERE id = @id
`)

function rowToWordRecord(row) {
  return {
    id: row.id,
    word: row.word,
    timeStamp: row.time_stamp,
    dict: row.dict,
    chapter: row.chapter,
    timing: toJSON(row.timing_json, []),
    wrongCount: row.wrong_count,
    mistakes: toJSON(row.mistakes_json, {}),
  }
}

function rowToChapterRecord(row) {
  return {
    id: row.id,
    dict: row.dict,
    chapter: row.chapter,
    timeStamp: row.time_stamp,
    time: row.time,
    correctCount: row.correct_count,
    wrongCount: row.wrong_count,
    wordCount: row.word_count,
    correctWordIndexes: toJSON(row.correct_word_indexes_json, []),
    wordNumber: row.word_number,
    wordRecordIds: toJSON(row.word_record_ids_json, []),
  }
}

function rowToReviewRecord(row) {
  return {
    id: row.id,
    dict: row.dict,
    index: row.idx,
    createTime: row.create_time,
    isFinished: row.is_finished === 1,
    words: toJSON(row.words_json, []),
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, sqlitePath: SQLITE_PATH })
})

app.get('/api/word-records', (_req, res) => {
  const rows = getAllWordRecordsStmt.all().map(rowToWordRecord)
  res.json(rows)
})

app.post('/api/word-records', (req, res) => {
  const payload = req.body
  const info = insertWordRecordStmt.run({
    word: payload.word,
    timeStamp: payload.timeStamp,
    dict: payload.dict,
    chapter: payload.chapter ?? null,
    timing_json: JSON.stringify(payload.timing ?? []),
    wrongCount: payload.wrongCount ?? 0,
    mistakes_json: JSON.stringify(payload.mistakes ?? {}),
  })
  res.json({ id: Number(info.lastInsertRowid) })
})

app.delete('/api/word-records', (req, res) => {
  const { word, dict } = req.query
  if (!word || !dict) {
    res.status(400).json({ message: 'word and dict are required' })
    return
  }
  const info = deleteWordRecordStmt.run(String(word), String(dict))
  res.json({ deletedCount: info.changes })
})

app.get('/api/word-records/count', (_req, res) => {
  const row = wordCountStmt.get()
  res.json({ count: row.count })
})

app.get('/api/chapter-records', (_req, res) => {
  const rows = getAllChapterRecordsStmt.all().map(rowToChapterRecord)
  res.json(rows)
})

app.post('/api/chapter-records', (req, res) => {
  const payload = req.body
  const info = insertChapterRecordStmt.run({
    dict: payload.dict,
    chapter: payload.chapter ?? null,
    timeStamp: payload.timeStamp,
    time: payload.time,
    correctCount: payload.correctCount ?? 0,
    wrongCount: payload.wrongCount ?? 0,
    wordCount: payload.wordCount ?? 0,
    correct_word_indexes_json: JSON.stringify(payload.correctWordIndexes ?? []),
    wordNumber: payload.wordNumber ?? 0,
    word_record_ids_json: JSON.stringify(payload.wordRecordIds ?? []),
  })
  res.json({ id: Number(info.lastInsertRowid) })
})

app.get('/api/chapter-records/count', (_req, res) => {
  const row = chapterCountStmt.get()
  res.json({ count: row.count })
})

app.get('/api/review-records', (_req, res) => {
  const rows = getAllReviewRecordsStmt.all().map(rowToReviewRecord)
  res.json(rows)
})

app.post('/api/review-records', (req, res) => {
  const payload = req.body
  const body = {
    id: payload.id,
    dict: payload.dict,
    index: payload.index ?? 0,
    createTime: payload.createTime ?? Math.floor(Date.now() / 1000),
    isFinished: payload.isFinished ? 1 : 0,
    words_json: JSON.stringify(payload.words ?? []),
  }

  if (body.id) {
    const info = updateReviewRecordStmt.run(body)
    if (info.changes > 0) {
      res.json({ id: body.id })
      return
    }
  }

  const info = insertReviewRecordStmt.run(body)
  res.json({ id: Number(info.lastInsertRowid) })
})

app.get('/api/sqlite/download', (_req, res) => {
  res.download(SQLITE_PATH, 'progress.sqlite')
})

app.post('/api/sqlite/upload', upload.single('sqliteFile'), (req, res) => {
  const fileBuffer = req.file?.buffer
  if (!fileBuffer) {
    res.status(400).json({ message: 'sqliteFile is required' })
    return
  }

  const tempFile = path.resolve(PROJECT_ROOT, '.progress-import-temp.sqlite')
  let importDb
  try {
    fs.writeFileSync(tempFile, fileBuffer)
    importDb = new Database(tempFile, { readonly: true })

    const importedWordRows = importDb
      .prepare(
        'SELECT id, word, time_stamp, dict, chapter, timing_json, wrong_count, mistakes_json FROM word_records ORDER BY id ASC',
      )
      .all()
    const importedChapterRows = importDb
      .prepare(
        'SELECT id, dict, chapter, time_stamp, time, correct_count, wrong_count, word_count, correct_word_indexes_json, word_number, word_record_ids_json FROM chapter_records ORDER BY id ASC',
      )
      .all()
    const importedReviewRows = importDb
      .prepare('SELECT id, dict, idx, create_time, is_finished, words_json FROM review_records ORDER BY id ASC')
      .all()

    const replaceAll = db.transaction(() => {
      db.exec('DELETE FROM word_records; DELETE FROM chapter_records; DELETE FROM review_records;')

      const insertWord = db.prepare(`
        INSERT INTO word_records (id, word, time_stamp, dict, chapter, timing_json, wrong_count, mistakes_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const insertChapter = db.prepare(`
        INSERT INTO chapter_records (id, dict, chapter, time_stamp, time, correct_count, wrong_count, word_count, correct_word_indexes_json, word_number, word_record_ids_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const insertReview = db.prepare(`
        INSERT INTO review_records (id, dict, idx, create_time, is_finished, words_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `)

      for (const row of importedWordRows) {
        insertWord.run(row.id, row.word, row.time_stamp, row.dict, row.chapter, row.timing_json, row.wrong_count, row.mistakes_json)
      }
      for (const row of importedChapterRows) {
        insertChapter.run(
          row.id,
          row.dict,
          row.chapter,
          row.time_stamp,
          row.time,
          row.correct_count,
          row.wrong_count,
          row.word_count,
          row.correct_word_indexes_json,
          row.word_number,
          row.word_record_ids_json,
        )
      }
      for (const row of importedReviewRows) {
        insertReview.run(row.id, row.dict, row.idx, row.create_time, row.is_finished, row.words_json)
      }
    })

    replaceAll()
    db.pragma('wal_checkpoint(TRUNCATE)')
    res.json({ ok: true })
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : '导入 SQLite 失败' })
  } finally {
    if (importDb) {
      importDb.close()
    }
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile)
    }
  }
})

if (fs.existsSync(BUILD_DIR)) {
  app.use(express.static(BUILD_DIR))
  app.get('/{*splat}', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next()
      return
    }
    res.sendFile(path.resolve(BUILD_DIR, 'index.html'))
  })
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  console.log(`SQLite file: ${SQLITE_PATH}`)
})
