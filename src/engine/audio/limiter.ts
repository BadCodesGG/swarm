/**
 * Rate discipline for a stream of sounds. Offers arrive whenever the bus emits; once per frame the
 * engine flushes, and the limiter admits the best-ranked ones that fit a sliding one-second budget.
 * Whatever does not fit is dropped rather than carried over, because a late sound is a wrong sound.
 * This is what keeps a replay at 200x from becoming a wall of sound.
 */
export class RateLimiter<T> {
  private items: T[] = [];
  private ranks: number[] = [];
  /** Admission times inside the current window, oldest first. */
  private stamps: number[] = [];

  /**
   * @param perSecond Hard cap on admissions in any one-second window.
   * @param perFlush Cap on one flush, so a burst does not spend the whole second's budget on one frame.
   * @param maxPending Offers beyond this between two flushes are ignored.
   */
  constructor(
    private readonly perSecond: number,
    private readonly perFlush: number = perSecond,
    private readonly maxPending: number = 256,
  ) {}

  /** `rank`: lower plays first when there is not room for every offer. */
  offer(item: T, rank: number): void {
    if (this.items.length >= this.maxPending) return;
    this.items.push(item);
    this.ranks.push(rank);
  }

  /** Forget everything offered since the last flush. */
  clear(): void {
    this.items = [];
    this.ranks = [];
  }

  /** The admitted offers, lowest rank first (ties in offer order). Clears everything else. */
  flush(now: number): T[] {
    let drop = 0;
    while (drop < this.stamps.length && this.stamps[drop] <= now - 1) drop++;
    if (drop) this.stamps.splice(0, drop);

    const room = Math.min(this.perFlush, this.perSecond - this.stamps.length);
    const order = this.items.map((_, i) => i).sort((a, b) => this.ranks[a] - this.ranks[b]);
    const admitted = order.slice(0, Math.max(0, room)).map((i) => this.items[i]);
    for (let i = 0; i < admitted.length; i++) this.stamps.push(now);

    this.items = [];
    this.ranks = [];
    return admitted;
  }
}
