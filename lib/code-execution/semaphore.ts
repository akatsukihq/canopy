/** Counting semaphore. `acquire` resolves a release function, or null after waiting `waitMs`. */
export type Semaphore = {
  readonly acquire: (signal: AbortSignal, waitMs: number) => Promise<(() => void) | null>;
};

export function createSemaphore(max: number): Semaphore {
  let active = 0;
  const waiters: Array<() => void> = [];

  const release = (): void => {
    const next = waiters.shift();
    if (next) next();
    else active -= 1;
  };
  const makeRelease = (): (() => void) => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      release();
    };
  };

  return {
    acquire(signal, waitMs) {
      signal.throwIfAborted();
      if (active < max) {
        active += 1;
        return Promise.resolve(makeRelease());
      }
      return new Promise((resolve, reject) => {
        const cleanup = (): void => {
          clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          const index = waiters.indexOf(grant);
          if (index !== -1) waiters.splice(index, 1);
        };
        // A granted waiter inherits the releaser's slot, so `active` is unchanged.
        const grant = (): void => {
          cleanup();
          resolve(makeRelease());
        };
        const onAbort = (): void => {
          cleanup();
          reject(signal.reason);
        };
        const timer = setTimeout(() => {
          cleanup();
          resolve(null);
        }, waitMs);
        waiters.push(grant);
        signal.addEventListener("abort", onAbort, { once: true });
      });
    },
  };
}
