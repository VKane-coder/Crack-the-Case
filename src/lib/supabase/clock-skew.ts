// Supabase rejects a freshly issued sign-in token for a moment with PGRST303 "JWT issued at future":
// Supabase Auth stamps the token with its own clock, and if the data API's clock is a fraction of a
// second behind, a request made straight after sign-in or a token refresh looks like it comes from the
// future. Waiting a second and trying again is all it takes (it's what a reload did).

const RETRIES = 2;
const WAIT_MS = 1000;

/** A fetch for Supabase clients that retries data requests rejected with PGRST303. */
export function retryClockSkew(
  baseFetch: typeof fetch = fetch,
  wait = (ms: number) => new Promise((r) => setTimeout(r, ms)),
): typeof fetch {
  return async (input, init) => {
    for (let attempt = 0; ; attempt++) {
      const res = await baseFetch(input, init);
      if (res.status !== 401 || attempt >= RETRIES) return res;
      const body = await res
        .clone()
        .text()
        .catch(() => "");
      if (!body.includes("PGRST303")) return res;
      await wait(WAIT_MS);
    }
  };
}
