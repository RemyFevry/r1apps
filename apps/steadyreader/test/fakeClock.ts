/** Manual virtual clock: schedule/cancel/now seams, advance fires tasks in order. */
export class FakeClock {
  t = 0
  private seq = 1
  private tasks = new Map<number, { at: number; fn: () => void }>()

  now(): number {
    return this.t
  }

  schedule(fn: () => void, ms: number): number {
    const id = this.seq++
    this.tasks.set(id, { at: this.t + ms, fn })
    return id
  }

  cancel(id: number): void {
    this.tasks.delete(id)
  }

  /** Earliest-task-first to target time; now() is correct inside each callback. */
  advance(ms: number): void {
    const target = this.t + ms
    const EPS = 1e-6 // dwell products carry float error (200×2.2 = 440.00000000000006)
    for (;;) {
      let best: { id: number; at: number; fn: () => void } | null = null
      for (const [id, task] of this.tasks) {
        if (task.at <= target + EPS && (!best || task.at < best.at)) best = { id, ...task }
      }
      if (!best) break
      this.tasks.delete(best.id)
      this.t = best.at
      best.fn()
    }
    this.t = target
  }
}
