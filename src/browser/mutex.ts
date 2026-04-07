/**
 * Simple FIFO mutex with guard pattern for safe release.
 * Used for per-tab locks and browser-level structural operations.
 */
export class Mutex {
  #locked = false;
  #queue: Array<() => void> = [];

  async acquire(): Promise<MutexGuard> {
    if (!this.#locked) {
      this.#locked = true;
      return new MutexGuard(this);
    }
    await new Promise<void>((resolve) => this.#queue.push(resolve));
    return new MutexGuard(this);
  }

  release(): void {
    const next = this.#queue.shift();
    if (!next) {
      this.#locked = false;
      return;
    }
    next();
  }
}

export class MutexGuard {
  #mutex: Mutex;

  constructor(mutex: Mutex) {
    this.#mutex = mutex;
  }

  dispose(): void {
    this.#mutex.release();
  }
}
