/**
 * Chapter-stream player: a thin wrapper over the audio element (ADR-0014).
 * `load` accepts the chapter's audio bytes as a Blob (object URL created and
 * revoked here, so URL lifecycle stays inside the module). `seek`/`setPlaybackRate`
 * work before playback starts (queued until metadata). `onError` surfaces the
 * element's error event to the driver.
 */
export interface ChapterPlayer {
  load(audio: Blob): void
  play(): void
  pause(): void
  /** Scrub to a media-timeline position (safe before play; queued until metadata). */
  seek(t: number): void
  setPlaybackRate(r: number): void
  readonly currentTime: number
  readonly ended: boolean
  /** Assigned by the driver; the element's error event fires it. */
  onError: (() => void) | null
  /** Pause + release the source. */
  destroy(): void
}

export class HtmlChapterPlayer implements ChapterPlayer {
  private el = new Audio()
  private url: string | null = null
  onError: (() => void) | null = null

  constructor() {
    this.el.onerror = () => this.onError?.()
  }

  load(audio: Blob): void {
    this.url = URL.createObjectURL(audio)
    this.el.src = this.url
  }

  play(): void {
    void this.el.play().catch(() => {})
  }

  pause(): void {
    this.el.pause()
  }

  seek(t: number): void {
    this.el.currentTime = t
  }

  setPlaybackRate(r: number): void {
    this.el.playbackRate = r
  }

  get currentTime(): number {
    return this.el.currentTime
  }

  get ended(): boolean {
    return this.el.ended
  }

  destroy(): void {
    this.el.pause()
    this.el.src = ''
    if (this.url) {
      URL.revokeObjectURL(this.url)
      this.url = null
    }
  }
}
