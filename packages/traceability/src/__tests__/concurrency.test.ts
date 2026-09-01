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
});
