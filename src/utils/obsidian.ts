export async function syncChapterToObsidian(payload: { words: Array<{ name: string; trans: string[] }> }) {
  try {
    await fetch('/api/obsidian/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    console.error('[obsidian-sync] 请求失败:', err)
  }
}
