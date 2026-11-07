/** First-come slot budget: a queued holder starts as soon as an active one releases. */
export function createSlotPool(limit: number): (activate: () => void) => () => void {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('CANVAS_SLOT_LIMIT_INVALID')
  type Entry = { active: boolean, activate: () => void }
  const entries: Entry[] = []
  const pump = () => {
    let active = entries.filter(entry => entry.active).length
    for (const entry of entries) {
      if (active >= limit) break
      if (entry.active) continue
      entry.active = true; active += 1
      entry.activate()
    }
  }
  return activate => {
    const entry = { active: false, activate }
    entries.push(entry); pump()
    return () => {
      const index = entries.indexOf(entry)
      if (index < 0) return
      entries.splice(index, 1); pump()
    }
  }
}
