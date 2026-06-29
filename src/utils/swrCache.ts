import { useEffect, useRef, useState, useCallback } from 'react';

type Entry = { data: any; ts: number };
const mem = new Map<string, Entry>();
const LS_PREFIX = 'swr:';
const MAX_LS_BYTES = 1_000_000; // 单条超过则不写 localStorage,避免塞爆

function lsGet(key: string): Entry | undefined {
  try { const s = localStorage.getItem(LS_PREFIX + key); return s ? JSON.parse(s) as Entry : undefined; } catch { return undefined; }
}
function lsSet(key: string, entry: Entry) {
  try { const s = JSON.stringify(entry); if (s.length <= MAX_LS_BYTES) localStorage.setItem(LS_PREFIX + key, s); } catch { /* 配额满则忽略 */ }
}

export function getCached(key: string): any | undefined {
  if (mem.has(key)) return mem.get(key)!.data;
  const e = lsGet(key);
  if (e) { mem.set(key, e); return e.data; }
  return undefined;
}
export function setCached(key: string, data: any) {
  const entry = { data, ts: Date.now() };
  mem.set(key, entry);
  lsSet(key, entry);
}
/** 失效所有以 prefix 开头的缓存键(内存 + localStorage)。 */
export function invalidateCache(prefix: string) {
  for (const k of Array.from(mem.keys())) if (k.startsWith(prefix)) mem.delete(k);
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const full = localStorage.key(i);
      if (full && full.startsWith(LS_PREFIX + prefix)) localStorage.removeItem(full);
    }
  } catch { /* ignore */ }
}

/**
 * stale-while-revalidate:命中缓存立即返回(loading=false),同时后台 fetcher 刷新;
 * 无缓存则 loading=true 直到首次拉到。key 为 null 时不请求。
 */
export function useSWR<T = any>(key: string | null, fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | undefined>(() => (key ? getCached(key) : undefined));
  const [loading, setLoading] = useState<boolean>(() => (key ? getCached(key) === undefined : false));
  const fetcherRef = useRef(fetcher); fetcherRef.current = fetcher;

  const revalidate = useCallback(async () => {
    if (!key) return;
    try {
      const fresh = await fetcherRef.current();
      setCached(key, fresh);
      setData(fresh);
    } catch (e) {
      console.warn('[swr] revalidate failed for', key, e);
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    if (!key) { setData(undefined); setLoading(false); return; }
    const cached = getCached(key);
    if (cached !== undefined) { setData(cached); setLoading(false); } else { setLoading(true); }
    revalidate();
  }, [key, revalidate]);

  return { data, loading, refetch: revalidate };
}
