import { describe, expect, it } from 'vitest';
import { createTaskLimiter } from '../concurrency.js';

describe('createTaskLimiter', () => {
  it('caps active tasks and preserves Promise.all result order', async () => {
    let active = 0;
    let peak = 0;
    const limit = createTaskLimiter(2);
    const delays = [30, 5, 20, 1, 10];

    const results = await Promise.all(
      delays.map((delay, index) =>
        limit(async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, delay));
          active -= 1;
          return index;
        })
      )
    );

    expect(peak).toBe(2);
    expect(results).toEqual([0, 1, 2, 3, 4]);
  });

  it('does not start queued tasks after the first task rejects', async () => {
    const limit = createTaskLimiter(2);
    const started: number[] = [];
    const tasks = [0, 1, 2, 3].map((index) =>
      limit(async () => {
        started.push(index);
        if (index === 0) {
          throw new Error('first task failed');
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
        return index;
      })
    );

    const settled = await Promise.allSettled(tasks);

    expect(started).toEqual([0, 1]);
    expect(settled[0].status).toBe('rejected');
    expect(settled[1].status).toBe('fulfilled');
    expect(settled[2].status).toBe('rejected');
    expect(settled[3].status).toBe('rejected');
  });
});
