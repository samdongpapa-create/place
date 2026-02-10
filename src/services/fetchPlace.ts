import { cacheGet, cacheSet } from "../core/cache.js";
import { httpGet } from "../core/http.js";

export async function fetchPlaceHtml(placeUrl: string): Promise<string> {
  const key = `html:${placeUrl}`;
  const cached = cacheGet<string>(key);
  if (cached) return cached;

  const html = await httpGet(placeUrl);
  cacheSet(key, html);
  return html;
}
