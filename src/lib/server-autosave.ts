export type SaveStatus = "saving" | "saved" | "error";

/** Serialize writes and retain the newest snapshot during a request or outage. */
export class ServerAutosave {
  private pending: string | undefined;
  private running: Promise<void> | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(
    private readonly write: (json: string) => Promise<void>,
    private readonly status: (status: SaveStatus) => void,
    private saved: string | undefined,
    private readonly retryMs = 2000,
  ) {}

  get hasUnsavedData(): boolean {
    return this.pending !== undefined || this.running !== undefined;
  }

  enqueue(json: string): void {
    if (json === this.saved && !this.hasUnsavedData) return;
    this.pending = json;
    clearTimeout(this.retry);
    this.start();
  }

  private start(): void {
    if (this.running) return;
    this.running = this.drain().finally(() => {
      this.running = undefined;
    });
  }

  private async drain(): Promise<void> {
    while (this.pending !== undefined) {
      const json = this.pending;
      this.pending = undefined;
      if (json === this.saved) continue;
      this.status("saving");
      try {
        await this.write(json);
        this.saved = json;
      } catch {
        this.pending ??= json;
        this.status("error");
        if (!this.stopped) {
          this.retry = setTimeout(() => this.start(), this.retryMs);
        }
        return;
      }
    }
    this.status("saved");
  }

  async flush(): Promise<void> {
    clearTimeout(this.retry);
    if (this.pending !== undefined) this.start();
    await this.running;
    if (this.pending !== undefined) throw new Error("Server save failed");
  }

  stopRetries(): void {
    this.stopped = true;
    clearTimeout(this.retry);
  }
}
