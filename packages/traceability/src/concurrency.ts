export type RunTaskLimited = <T>(task: () => Promise<T>) => Promise<T>;

/** Create one shared asynchronous task limiter for a top-level operation. */
export const createTaskLimiter = (concurrency: number): RunTaskLimited => {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('concurrency must be a positive integer');
  }

  let active = 0;
  const waiting: Array<() => void> = [];
  let aborted = false;
  let abortReason: unknown;

  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = (): void => {
        if (aborted) {
          reject(abortReason);
          return;
        }
        active += 1;
        void Promise.resolve()
          .then(task)
          .then(
            resolve,
            (error: unknown) => {
              if (!aborted) {
                aborted = true;
                abortReason = error;
              }
              reject(error);
            },
          )
          .finally(() => {
            active -= 1;
            if (aborted) {
              while (waiting.length > 0) waiting.shift()?.();
            } else {
              waiting.shift()?.();
            }
          });
      };

      if (aborted) reject(abortReason);
      else if (active < concurrency) run();
      else waiting.push(run);
    });
};
