/**
 * Run an async worker over `items` with at most `limit` in flight at once, so a
 * bulk action processes several items in parallel (each able to show its own
 * row spinner) without firing every network request at once.
 */
export async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}
