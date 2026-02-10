import { LRUCache } from "lru-cache";

export const cache = new LRUCache<string, any>({
  max: 500,
  ttl: 1000 * 60 * 30 // 30분
});

export function cacheGet<T>(key: string): T | undefined {
  return cache.get(key) as T | undefined;
}
export function cacheSet<T>(key: string, value: T) {
  cache.set(key, value);
}
