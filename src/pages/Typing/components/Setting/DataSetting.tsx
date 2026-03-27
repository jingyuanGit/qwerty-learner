import styles from './index.module.css'
import { db } from '@/utils/db'
import type { ExportProgress, ImportProgress } from '@/utils/db/data-export'
import { exportDatabase, importDatabase } from '@/utils/db/data-export'
import {
  bindLocalSqliteFile,
  flushLocalSqliteNow,
  getLocalSqliteSyncState,
  subscribeLocalSqliteSyncState,
  unbindLocalSqliteFile,
} from '@/utils/db/local-file-sync'
import * as Progress from '@radix-ui/react-progress'
import * as ScrollArea from '@radix-ui/react-scroll-area'
import { useCallback, useEffect, useState } from 'react'

export default function DataSetting() {
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)

  const [isImporting, setIsImporting] = useState(false)
  const [importProgress, setImportProgress] = useState(0)
  const [localSyncState, setLocalSyncState] = useState(getLocalSqliteSyncState())
  const [isBindingFile, setIsBindingFile] = useState(false)
  const [isManualSyncing, setIsManualSyncing] = useState(false)

  useEffect(() => {
    return subscribeLocalSqliteSyncState(setLocalSyncState)
  }, [])

  const exportProgressCallback = useCallback(({ totalRows, completedRows, done }: ExportProgress) => {
    if (done) {
      setIsExporting(false)
      setExportProgress(100)
      return true
    }
    if (totalRows) {
      setExportProgress(Math.floor((completedRows / totalRows) * 100))
    }

    return true
  }, [])

  const onClickExport = useCallback(() => {
    setExportProgress(0)
    setIsExporting(true)
    exportDatabase(exportProgressCallback)
  }, [exportProgressCallback])

  const importProgressCallback = useCallback(({ totalRows, completedRows, done }: ImportProgress) => {
    if (done) {
      setIsImporting(false)
      setImportProgress(100)
      return true
    }
    if (totalRows) {
      setImportProgress(Math.floor((completedRows / totalRows) * 100))
    }

    return true
  }, [])

  const onStartImport = useCallback(() => {
    setImportProgress(0)
    setIsImporting(true)
  }, [])

  const onClickImport = useCallback(() => {
    importDatabase(onStartImport, importProgressCallback)
  }, [importProgressCallback, onStartImport])

  const onBindSqlite = useCallback(async () => {
    setIsBindingFile(true)
    try {
      await bindLocalSqliteFile(db)
    } catch (error) {
      console.error(error)
      window.alert(error instanceof Error ? error.message : '绑定 SQLite 文件失败')
    } finally {
      setIsBindingFile(false)
    }
  }, [])

  const onManualSync = useCallback(async () => {
    setIsManualSyncing(true)
    try {
      await flushLocalSqliteNow(db)
    } catch (error) {
      console.error(error)
      window.alert(error instanceof Error ? error.message : '手动同步失败')
    } finally {
      setIsManualSyncing(false)
    }
  }, [])

  const onUnbindSqlite = useCallback(async () => {
    try {
      await unbindLocalSqliteFile()
    } catch (error) {
      console.error(error)
      window.alert(error instanceof Error ? error.message : '解绑 SQLite 文件失败')
    }
  }, [])

  return (
    <ScrollArea.Root className="flex-1 select-none overflow-y-auto ">
      <ScrollArea.Viewport className="h-full w-full px-3">
        <div className={styles.tabContent}>
          <div className={styles.section}>
            <span className={styles.sectionLabel}>本地 SQLite 自动保存</span>
            {!localSyncState.supported ? (
              <span className={styles.sectionDescription}>
                当前浏览器不支持本地文件自动写入。请使用最新版 Chrome/Edge 打开此页面后再绑定本地 SQLite 文件。
              </span>
            ) : (
              <>
                <span className={styles.sectionDescription}>
                  绑定后，练习进度会自动保存到你选择的本地 SQLite 文件。首次绑定需要授权，后续将自动同步。
                </span>
                <span className="pl-4 text-left text-sm text-gray-700 dark:text-gray-300">
                  当前状态：
                  {localSyncState.bound
                    ? `已绑定 ${localSyncState.fileName ?? 'sqlite 文件'}`
                    : localSyncState.initialized
                    ? '未绑定'
                    : '初始化中...'}
                </span>
                {localSyncState.lastError && (
                  <span className="pl-4 text-left text-sm text-red-500">错误信息：{localSyncState.lastError}</span>
                )}
                {localSyncState.lastSyncedAt && (
                  <span className="pl-4 text-left text-sm text-gray-700 dark:text-gray-300">
                    最近同步：{new Date(localSyncState.lastSyncedAt).toLocaleString()}
                  </span>
                )}
                <div className="flex flex-wrap gap-3 pl-4">
                  <button
                    className="my-btn-primary disabled:bg-gray-300"
                    type="button"
                    onClick={onBindSqlite}
                    disabled={isBindingFile || localSyncState.syncing}
                    title={localSyncState.bound ? '重新绑定 SQLite 文件' : '绑定 SQLite 文件'}
                  >
                    {localSyncState.bound ? '重新绑定文件' : '绑定 SQLite 文件'}
                  </button>
                  <button
                    className="my-btn-primary disabled:bg-gray-300"
                    type="button"
                    onClick={onManualSync}
                    disabled={!localSyncState.bound || isManualSyncing || localSyncState.syncing}
                    title="立即同步到本地文件"
                  >
                    立即同步
                  </button>
                  <button
                    className="my-btn-primary bg-gray-200 text-gray-700 disabled:bg-gray-300"
                    type="button"
                    onClick={onUnbindSqlite}
                    disabled={!localSyncState.bound || localSyncState.syncing}
                    title="解绑本地文件"
                  >
                    解绑
                  </button>
                </div>
              </>
            )}
          </div>
          <div className={styles.section}>
            <span className={styles.sectionLabel}>数据导出</span>
            <span className={styles.sectionDescription}>
              目前，用户的练习数据<strong>仅保存在本地</strong>。如果您需要在不同的设备、浏览器或者其他非官方部署上使用 Qwerty Learner，
              您需要手动进行数据同步和保存。为了保留您的练习进度，以及使用近期即将上线的数据分析和智能训练功能，
              我们建议您及时备份您的数据。
            </span>
            <span className="pl-4 text-left text-sm font-bold leading-tight text-red-500">
              为了您的数据安全，请不要修改导出的数据文件。
            </span>
            <div className="flex h-3 w-full items-center justify-start px-5">
              <Progress.Root
                className="translate-z-0 relative h-2 w-11/12 transform  overflow-hidden rounded-full bg-gray-200"
                value={exportProgress}
              >
                <Progress.Indicator
                  className="cubic-bezier(0.65, 0, 0.35, 1) h-full w-full bg-indigo-400 transition-transform duration-500 ease-out"
                  style={{ transform: `translateX(-${100 - exportProgress}%)` }}
                />
              </Progress.Root>
              <span className="ml-4 w-10 text-xs font-normal text-gray-600">{`${exportProgress}%`}</span>
            </div>

            <button
              className="my-btn-primary ml-4 disabled:bg-gray-300"
              type="button"
              onClick={onClickExport}
              disabled={isExporting}
              title="导出数据"
            >
              导出数据
            </button>
          </div>
          <div className={styles.section}>
            <span className={styles.sectionLabel}>数据导入</span>
            <span className={styles.sectionDescription}>
              请注意，导入数据将<strong className="text-sm font-bold text-red-500"> 完全覆盖 </strong>当前数据。请谨慎操作。
            </span>

            <div className="flex h-3 w-full items-center justify-start px-5">
              <Progress.Root
                className="translate-z-0 relative h-2 w-11/12 transform  overflow-hidden rounded-full bg-gray-200"
                value={importProgress}
              >
                <Progress.Indicator
                  className="cubic-bezier(0.65, 0, 0.35, 1) h-full w-full bg-indigo-400 transition-transform duration-500 ease-out"
                  style={{ transform: `translateX(-${100 - importProgress}%)` }}
                />
              </Progress.Root>
              <span className="ml-4 w-10 text-xs font-normal text-gray-600">{`${importProgress}%`}</span>
            </div>

            <button
              className="my-btn-primary ml-4 disabled:bg-gray-300"
              type="button"
              onClick={onClickImport}
              disabled={isImporting}
              title="导入数据"
            >
              导入数据
            </button>
          </div>
        </div>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar className="flex touch-none select-none bg-transparent " orientation="vertical"></ScrollArea.Scrollbar>
    </ScrollArea.Root>
  )
}
