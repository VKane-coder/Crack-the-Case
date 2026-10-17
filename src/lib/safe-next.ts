/**
 * Returns a same-origin path for post-auth redirects, or the fallback.
 * Rejects absolute URLs, protocol-relative (`//evil.com`) and backslash tricks (`/\evil.com`).
 */
export function safeNext(value: string | null | undefined, fallback = "/hub"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  // Control characters can be normalised away by browsers, turning "/\t/evil.com" into "//evil.com".
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  try {
    const url = new URL(value, "http://local.invalid");
    if (url.origin !== "http://local.invalid") return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
