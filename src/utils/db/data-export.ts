import { db } from '.'
import { recordDataAction } from '..'

export type ExportProgress = {
  totalRows?: number
  completedRows: number
  done: boolean
}

export type ImportProgress = {
  totalRows?: number
  completedRows: number
  done: boolean
}

export async function exportDatabase(callback: (exportProgress: ExportProgress) => boolean) {
  const [wordCount, chapterCount] = await Promise.all([db.wordRecords.count(), db.chapterRecords.count()])
  callback({ completedRows: 1, totalRows: 1, done: true })
  window.location.href = '/api/sqlite/download'
  recordDataAction({ type: 'export', size: 0, wordCount, chapterCount })
}

export async function importDatabase(onStart: () => void, callback: (importProgress: ImportProgress) => boolean) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.sqlite,.db,application/vnd.sqlite3'
  input.addEventListener('change', async () => {
    const file = input.files?.[0]
    if (!file) return

    onStart()
    callback({ completedRows: 0, totalRows: 1, done: false })

    const formData = new FormData()
    formData.append('sqliteFile', file)

    const response = await fetch('/api/sqlite/upload', {
      method: 'POST',
      body: formData,
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(text || '导入失败')
    }

    const [wordCount, chapterCount] = await Promise.all([db.wordRecords.count(), db.chapterRecords.count()])
    callback({ completedRows: 1, totalRows: 1, done: true })
    recordDataAction({ type: 'import', size: file.size, wordCount, chapterCount })
    window.location.reload()
  })

  input.click()
}
