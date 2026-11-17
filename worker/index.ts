import bcrypt from "bcryptjs";

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_PIN_HASH: string;
  SESSION_TTL_SECONDS?: string;
}

type TemplateInput = { name: string; spiel: string; active: boolean };
const SESSION_COOKIE = "spiel_admin_session";
const SESSION_TTL = 15 * 60;
const WINDOW_MS = 15 * 60 * 1000;

const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });

const error = (message: string, status: number) => json({ error: message }, status);

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function cookieValue(request: Request): string | null {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(SESSION_COOKIE.length + 1)) : null;
}

function setSessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL}`;
}

function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

async function getSession(request: Request, env: Env): Promise<boolean> {
  const token = cookieValue(request);
  if (!token) return false;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    "SELECT token_hash FROM admin_sessions WHERE token_hash = ? AND expires_at > ?"
  ).bind(tokenHash, Math.floor(Date.now() / 1000)).first();
  return Boolean(row);
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

async function clientIpHash(request: Request): Promise<string> {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  return sha256(ip);
}

async function loginLocked(request: Request, env: Env): Promise<boolean> {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const ipHash = await clientIpHash(request);

  const [global, perIp] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS count FROM login_attempts WHERE attempted_at > ?")
      .bind(cutoff).first<{ count: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM login_attempts WHERE ip_hash = ? AND attempted_at > ?")
      .bind(ipHash, cutoff).first<{ count: number }>(),
  ]);

  return Number(global?.count || 0) >= 10 || Number(perIp?.count || 0) >= 5;
}

async function recordFailure(request: Request, env: Env): Promise<void> {
  await env.DB.prepare("INSERT INTO login_attempts (ip_hash, attempted_at) VALUES (?, ?)")
    .bind(await clientIpHash(request), Date.now()).run();
  await env.DB.prepare("DELETE FROM login_attempts WHERE attempted_at <= ?")
    .bind(Date.now() - WINDOW_MS).run();
}

function validateTemplate(body: unknown): { ok: true; value: TemplateInput } | { ok: false; message: string } {
  if (!body || typeof body !== "object") return { ok: false, message: "Invalid template." };
  const value = body as Record<string, unknown>;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const spiel = typeof value.spiel === "string" ? value.spiel.trim() : "";
  const active = value.active === undefined ? true : value.active;
  if (!name || name.length > 120) return { ok: false, message: "Name must be between 1 and 120 characters." };
  if (!spiel || spiel.length > 10000 || !spiel.includes("{{TIME}}"))
    return { ok: false, message: "Spiel must contain {{TIME}} and be no longer than 10,000 characters." };
  if (typeof active !== "boolean") return { ok: false, message: "Active must be true or false." };
  return { ok: true, value: { name, spiel, active } };
}

async function listTemplates(env: Env, adminView = false) {
  const query = adminView
    ? "SELECT id, name, spiel, active FROM spiel_templates ORDER BY CAST(id AS INTEGER), id"
    : "SELECT id, name FROM spiel_templates WHERE active = 1 ORDER BY CAST(id AS INTEGER), id";
  const result = await env.DB.prepare(query).all();
  return (result.results || []).map((row: Record<string, unknown>) => ({
    ...row,
    id: String(row.id),
    ...(adminView ? { active: Boolean(row.active) } : {}),
  }));
}

async function timeResponse(url: URL): Promise<Response> {
  const zone = url.searchParams.get("timeZone") || "";
  if (!/^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+.-]+)+$/.test(zone)) {
    return error("Valid IANA time zone required.", 400);
  }

  try {
    const response = await fetch("https://timeapi.io/api/Time/current/zone?timeZone=UTC", {
      signal: AbortSignal.timeout(8000),
      headers: { "Cache-Control": "no-cache" },
    });
    if (!response.ok) throw new Error(`TimeAPI.io returned HTTP ${response.status}`);
    const data = await response.json() as { dateTime?: string };
    if (typeof data.dateTime !== "string") throw new Error("TimeAPI.io response did not contain dateTime.");
    const normalized = data.dateTime.replace(/(\.\d{3})\d+$/, "$1");
    const epochMs = Date.parse(`${normalized}Z`);
    if (!Number.isFinite(epochMs)) throw new Error("TimeAPI.io returned an invalid UTC timestamp.");
    return json({ epochMs, source: "TimeAPI.io" });
  } catch (primaryError) {
    try {
      const response = await fetch(`https://gateway.timeapi.world/timezone/${encodeURIComponent(zone)}`, {
        signal: AbortSignal.timeout(8000),
        headers: { "Cache-Control": "no-cache" },
      });
      if (!response.ok) throw new Error(`Fallback time service returned HTTP ${response.status}`);
      const data = await response.json() as { unixtime?: number };
      if (typeof data.unixtime !== "number" || !Number.isFinite(data.unixtime))
        throw new Error("Fallback time service returned an invalid unixtime.");
      return json({ epochMs: data.unixtime * 1000, source: "TimeAPI World" });
    } catch (fallbackError) {
      console.error("Online time providers failed", {
        primary: primaryError instanceof Error ? primaryError.message : String(primaryError),
        fallback: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
      });
      return json({
        error: "Online time providers are unavailable. Computer time was not used.",
        details: "The primary and fallback online time services could not provide a valid timestamp.",
      }, 503);
    }
  }
}

async function api(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (path === "/api/health" && method === "GET") {
    return json({ ok: true, storage: "cloudflare-d1" });
  }

  if (path === "/api/time" && method === "GET") return timeResponse(url);

  if (path === "/api/templates" && method === "GET") {
    return json({ templates: await listTemplates(env) });
  }

  const publicMatch = path.match(/^\/api\/templates\/([^/]+)$/);
  if (publicMatch && method === "GET") {
    const row = await env.DB.prepare(
      "SELECT id, name, spiel FROM spiel_templates WHERE id = ? AND active = 1"
    ).bind(decodeURIComponent(publicMatch[1])).first<Record<string, unknown>>();
    if (!row) return error("Spiel not found.", 404);
    return json({ template: { ...row, id: String(row.id) } });
  }

  if (path.startsWith("/api/admin/") && ["POST", "PUT", "PATCH", "DELETE"].includes(method) && !sameOrigin(request)) {
    return error("Cross-origin admin request rejected.", 403);
  }

  if (path === "/api/admin/login" && method === "POST") {
    if (await loginLocked(request, env)) {
      return error("Too many incorrect attempts. Admin login is locked for 15 minutes.", 429);
    }
    let body: { pin?: unknown };
    try { body = await request.json() as { pin?: unknown }; }
    catch { return error("Invalid request body.", 400); }
    const pin = typeof body.pin === "string" ? body.pin : "";
    if (pin.length < 8 || pin.length > 128 || !env.ADMIN_PIN_HASH) {
      await recordFailure(request, env);
      return error("Incorrect PIN.", 401);
    }

    let valid = false;
    try { valid = await bcrypt.compare(pin, env.ADMIN_PIN_HASH); }
    catch (e) { console.error("PIN verification failed", e); return error("Administrator authentication is temporarily unavailable.", 500); }

    if (!valid) {
      await recordFailure(request, env);
      return error("Incorrect PIN.", 401);
    }

    const token = `${crypto.randomUUID()}${crypto.randomUUID().replaceAll("-", "")}`;
    const tokenHash = await sha256(token);
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").bind(now).run();
    await env.DB.prepare("INSERT INTO admin_sessions (token_hash, expires_at, created_at) VALUES (?, ?, ?)")
      .bind(tokenHash, now + SESSION_TTL, now).run();

    return json({ authenticated: true }, 200, { "Set-Cookie": setSessionCookie(token) });
  }

  if (path === "/api/admin/logout" && method === "POST") {
    if (!(await getSession(request, env))) return error("Administrator authentication required.", 401);
    const token = cookieValue(request);
    if (token) await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(await sha256(token)).run();
    return json({ authenticated: false }, 200, { "Set-Cookie": clearSessionCookie() });
  }

  if (path === "/api/admin/session" && method === "GET") {
    return (await getSession(request, env)) ? json({ authenticated: true }) : error("Administrator authentication required.", 401);
  }

  if (path === "/api/admin/templates" && method === "GET") {
    if (!(await getSession(request, env))) return error("Administrator authentication required.", 401);
    return json({ templates: await listTemplates(env, true) });
  }

  if (path === "/api/admin/templates" && method === "POST") {
    if (!(await getSession(request, env))) return error("Administrator authentication required.", 401);
    let body: unknown;
    try { body = await request.json(); } catch { return error("Invalid request body.", 400); }
    const parsed = validateTemplate(body);
    if (!parsed.ok) return error(parsed.message, 400);
    const max = await env.DB.prepare("SELECT MAX(CAST(id AS INTEGER)) AS maxId FROM spiel_templates").first<{ maxId: number | null }>();
    const id = String(Number(max?.maxId || 0) + 1);
    const now = new Date().toISOString();
    await env.DB.prepare("INSERT INTO spiel_templates (id, name, spiel, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, parsed.value.name, parsed.value.spiel, parsed.value.active ? 1 : 0, now, now).run();
    return json({ template: { id, ...parsed.value } }, 201);
  }

  const adminMatch = path.match(/^\/api\/admin\/templates\/([^/]+)$/);
  if (adminMatch) {
    if (!(await getSession(request, env))) return error("Administrator authentication required.", 401);
    const id = decodeURIComponent(adminMatch[1]);
    if (method === "PUT") {
      let body: unknown;
      try { body = await request.json(); } catch { return error("Invalid request body.", 400); }
      const parsed = validateTemplate(body);
      if (!parsed.ok) return error(parsed.message, 400);
      const result = await env.DB.prepare(
        "UPDATE spiel_templates SET name = ?, spiel = ?, active = ?, updated_at = ? WHERE id = ?"
      ).bind(parsed.value.name, parsed.value.spiel, parsed.value.active ? 1 : 0, new Date().toISOString(), id).run();
      if (!result.meta.changes) return error("Template not found.", 404);
      return json({ template: { id, ...parsed.value } });
    }
    if (method === "DELETE") {
      const result = await env.DB.prepare("DELETE FROM spiel_templates WHERE id = ?").bind(id).run();
      if (!result.meta.changes) return error("Template not found.", 404);
      return json({ deleted: true });
    }
  }

  return error("Not found.", 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try { return await api(request, env); }
      catch (e) {
        console.error("API error", e);
        return error("An unexpected server error occurred.", 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};
