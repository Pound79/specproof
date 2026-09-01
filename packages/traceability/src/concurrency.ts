export type RunTaskLimited = <T>(task: () => Promise<T>) => Promise<T>;

/** Create one shared asynchronous task limiter for a top-level operation. */
export const createTaskLimiter = (concurrency: number): RunTaskLimited => {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('concurrency must be a positive integer');
  }

  let active = 0;
  const waiting: Array<() => void> = [];

  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = (): void => {
        active += 1;
        void Promise.resolve()
          .then(task)
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            waiting.shift()?.();
          });
      };

      if (active < concurrency) run();
      else waiting.push(run);
    });
};
