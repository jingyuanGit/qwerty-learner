import styles from './index.module.css'
import { isObsidianSyncEnabledAtom } from '@/store'
import { Switch } from '@headlessui/react'
import * as ScrollArea from '@radix-ui/react-scroll-area'
import { useAtom } from 'jotai'
import { useCallback } from 'react'

export default function ObsidianSetting() {
  const [isObsidianSyncEnabled, setIsObsidianSyncEnabled] = useAtom(isObsidianSyncEnabledAtom)

  const onToggleObsidianSync = useCallback(
    (checked: boolean) => {
      setIsObsidianSyncEnabled(checked)
    },
    [setIsObsidianSyncEnabled],
  )

  return (
    <ScrollArea.Root className="flex-1 select-none overflow-y-auto ">
      <ScrollArea.Viewport className="h-full w-full px-3">
        <div className={styles.tabContent}>
          <div className={styles.section}>
            <span className={styles.sectionLabel}>同步进度到 Obsidian</span>
            <span className={styles.sectionDescription}>
              开启后，每次完成一个章节会把练习结果追加同步到服务端 OBSIDIAN_PROGRESS_PATH 环境变量指定的 progress.md 文件中
            </span>
            <div className={styles.switchBlock}>
              <Switch checked={isObsidianSyncEnabled} onChange={onToggleObsidianSync} className="switch-root">
                <span aria-hidden="true" className="switch-thumb" />
              </Switch>
              <span className="text-right text-xs font-normal leading-tight text-gray-600">{`同步已${
                isObsidianSyncEnabled ? '开启' : '关闭'
              }`}</span>
            </div>
          </div>
        </div>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar className="flex touch-none select-none bg-transparent " orientation="vertical"></ScrollArea.Scrollbar>
    </ScrollArea.Root>
  )
}
