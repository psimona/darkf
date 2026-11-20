/** Copies `set` with `item`'s membership flipped. Shared by `run-detail.tsx`
 *  and `workflows-tab.tsx`'s own `toggleOpen` wrappers, each of which keeps
 *  its own signal — this is the pure flip body only, not a shared signal. */
export function flipInSet<T>(set: ReadonlySet<T>, item: T): ReadonlySet<T> {
  const next = new Set(set);
  if (next.has(item)) next.delete(item);
  else next.add(item);
  return next;
}
