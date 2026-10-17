/**
 * Applies migrations/seed and auth settings to the hosted Supabase project via the Management API
 * (HTTPS only, so it works where direct Postgres connections are blocked).
 *
 * Needs SUPABASE_ACCESS_TOKEN (personal access token) and NEXT_PUBLIC_SUPABASE_URL.
 *
 *   npm run supabase:admin -- status
 *   npm run supabase:admin -- migrate [--dry-run]
 *   npm run supabase:admin -- seed [--dry-run]
 *   npm run supabase:admin -- auth-config [--dry-run]
 *
 * Applied migrations are recorded in supabase_migrations.schema_migrations, the same table the
 * Supabase CLI uses, so `supabase db push` and this script agree on what has run.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const API = "https://api.supabase.com/v1";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function projectRef(): string {
  const host = new URL(env("NEXT_PUBLIC_SUPABASE_URL")).hostname;
  const ref = host.split(".")[0];
  if (!host.endsWith(".supabase.co") || !/^[a-z0-9]{20}$/.test(ref)) throw new Error(`Unexpected Supabase URL host: ${host}`);
  return ref;
}

async function api<T>(method: string, route: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}/projects/${projectRef()}${route}`, {
    method,
    headers: { Authorization: `Bearer ${env("SUPABASE_ACCESS_TOKEN")}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${route} → ${res.status}: ${text.slice(0, 500)}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

const query = <T = Record<string, unknown>>(sql: string) => api<T[]>("POST", "/database/query", { query: sql });
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

function sqlFiles(dir: string) {
  return readdirSync(path.join(ROOT, dir))
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ name: f, sql: readFileSync(path.join(ROOT, dir, f), "utf8") }));
}

async function appliedVersions(): Promise<Set<string>> {
  await query(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key, statements text[], name text
    );`);
  const rows = await query<{ version: string }>("select version from supabase_migrations.schema_migrations");
  return new Set(rows.map((r) => r.version));
}

async function status() {
  const applied = await appliedVersions();
  for (const m of sqlFiles("supabase/migrations")) {
    const version = m.name.split("_")[0];
    console.log(`${applied.has(version) ? "✓ applied " : "· pending "} ${m.name}`);
  }
}

async function migrate(dryRun: boolean) {
  const applied = await appliedVersions();
  const pending = sqlFiles("supabase/migrations").filter((m) => !applied.has(m.name.split("_")[0]));
  if (!pending.length) return console.log("Database is up to date.");
  for (const m of pending) {
    const [version, ...rest] = m.name.replace(/\.sql$/, "").split("_");
    console.log(`${dryRun ? "would apply" : "applying"} ${m.name}`);
    if (dryRun) continue;
    // One transaction per migration: the file and its bookkeeping row commit together or not at all.
    await query(`begin;
${m.sql}
insert into supabase_migrations.schema_migrations (version, name, statements) values (${lit(version)}, ${lit(rest.join("_"))}, array[${lit(m.sql)}]);
commit;`);
  }
  console.log("✓ migrations applied");
}

async function seed(dryRun: boolean) {
  for (const f of sqlFiles("supabase/seed")) {
    console.log(`${dryRun ? "would run" : "running"} seed ${f.name}`);
    if (!dryRun) await query(f.sql);
  }
  if (!dryRun) console.log("✓ seed applied (idempotent)");
}

async function authConfig(dryRun: boolean) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const allow = (process.env.SUPABASE_REDIRECT_URLS || "http://localhost:3000/**").split(",").map((s) => s.trim());
  if (!allow.some((u) => u.startsWith(siteUrl))) allow.push(`${siteUrl}/**`);

  const desired = {
    site_url: siteUrl,
    uri_allow_list: allow.join(","),
    mailer_otp_length: 6,
    mailer_otp_exp: 3600,
    mailer_subjects_magic_link: "Your Crack the Case sign-in link 🩺",
    mailer_templates_magic_link_content: readFileSync(path.join(ROOT, "supabase/templates/magic-link.html"), "utf8"),
  };

  const current = await api<Record<string, unknown>>("GET", "/config/auth");
  const changes = Object.fromEntries(Object.entries(desired).filter(([k, v]) => current[k] !== v));
  if (!Object.keys(changes).length) return console.log("Auth config already up to date.");
  for (const [k, v] of Object.entries(changes)) {
    const show = (x: unknown) => (typeof x === "string" && x.length > 80 ? `${x.slice(0, 77)}...` : JSON.stringify(x));
    console.log(`${k}: ${show(current[k])} → ${show(v)}`);
  }
  if (dryRun) return console.log("(dry run, nothing changed)");
  await api("PATCH", "/config/auth", changes);
  console.log("✓ auth config updated");
}

async function main() {
  const [command, ...flags] = process.argv.slice(2);
  const dryRun = flags.includes("--dry-run");
  switch (command) {
    case "status":
      return status();
    case "migrate":
      return migrate(dryRun);
    case "seed":
      return seed(dryRun);
    case "auth-config":
      return authConfig(dryRun);
    default:
      console.error("Usage: supabase-admin <status|migrate|seed|auth-config> [--dry-run]");
      process.exit(2);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
