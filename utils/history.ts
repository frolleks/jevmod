// ponytail: in-memory per-user message buffer, lost on restart; move to sqlite if history needs to survive a redeploy
const recentByUser = new Map<string, { content: string; at: number }[]>();
const HISTORY_WINDOW_MS = 60_000;
const HISTORY_MAX = 8;

export function pushHistory(key: string, content: string) {
  const now = Date.now();
  const list = (recentByUser.get(key) ?? []).filter((h) => now - h.at < HISTORY_WINDOW_MS);
  list.push({ content, at: now });
  if (list.length > HISTORY_MAX) list.shift();
  recentByUser.set(key, list);
  return list;
}
