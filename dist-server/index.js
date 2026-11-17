import "dotenv/config";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import express from "express";
import session from "express-session";
import createFileStore from "session-file-store";
import helmet from "helmet";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { fileURLToPath } from "node:url";
import { workbookStore } from "./workbook.js";
const app = express(), PORT = Number(process.env.PORT || 5000), prod = process.env.NODE_ENV === "production";
const securityDir = path.resolve(process.cwd(), "data");
const attemptsFile = path.join(securityDir, "admin-login-attempts.json");
const secret = process.env.SESSION_SECRET || "", pinHash = process.env.ADMIN_PIN_HASH || "";
if (secret.length < 32)
    throw new Error("SESSION_SECRET must be at least 32 characters.");
if (!pinHash)
    throw new Error("ADMIN_PIN_HASH missing. Run npm run hash-pin -- \"your-pin\".");
app.disable("x-powered-by");
if (prod)
    app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], connectSrc: ["'self'"], imgSrc: ["'self'", "data:"], objectSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'self'"] } } }));
app.use(express.json({ limit: "100kb" }));
const FileStore = createFileStore(session);
fs.mkdirSync(path.join(securityDir, "sessions"), { recursive: true });
app.use(session({ store: new FileStore({ path: path.join(securityDir, "sessions"), ttl: 900, retries: 0, reapInterval: 900 }), name: "spiel_admin_session", secret, resave: false, saveUninitialized: false, cookie: { httpOnly: true, secure: prod, sameSite: "strict", maxAge: 15 * 60 * 1000, path: "/" } }));
app.use("/api/admin", (req, res, next) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
        const origin = req.get("origin"), host = req.get("host");
        if (origin) {
            const originHost = new URL(origin).host;
            const viteDevOrigin = !prod && originHost === "localhost:5173";
            if (originHost !== host && !viteDevOrigin)
                return res.status(403).json({ error: "Cross-origin admin request rejected." });
        }
        else if (prod)
            return res.status(403).json({ error: "Missing request origin." });
    }
    next();
});
function readAttempts() {
    fs.mkdirSync(securityDir, { recursive: true });
    try {
        return JSON.parse(fs.readFileSync(attemptsFile, "utf8"));
    }
    catch {
        return { global: [], byIp: {} };
    }
}
function recordFailure(key) {
    const now = Date.now(), cutoff = now - 15 * 60 * 1000, state = readAttempts();
    state.global = (state.global || []).filter(t => t > cutoff);
    state.byIp[key] = (state.byIp[key] || []).filter(t => t > cutoff);
    state.global.push(now);
    state.byIp[key].push(now);
    const keys = Object.keys(state.byIp);
    for (const k of keys) {
        state.byIp[k] = state.byIp[k].filter(t => t > cutoff);
        if (!state.byIp[k].length)
            delete state.byIp[k];
    }
    const tmp = attemptsFile + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, attemptsFile);
}
function loginGuard(req, res, next) {
    const clientIp = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const key = crypto.createHash("sha256").update(clientIp).digest("hex");
    const now = Date.now();
    const cutoff = now - 15 * 60 * 1000;
    const state = readAttempts();
    state.global = (state.global || []).filter(t => t > cutoff);
    state.byIp[key] = (state.byIp[key] || []).filter(t => t > cutoff);
    if (state.global.length >= 10 || state.byIp[key].length >= 5) {
        return res.status(429).json({
            error: "Too many incorrect attempts. Admin login is locked for 15 minutes."
        });
    }
    req.failedLogin =
        () => recordFailure(key);
    return next();
}
function admin(req, res, next) { if (req.session.isAdmin)
    return next(); return res.status(401).json({ error: "Administrator authentication required." }); }
const schema = z.object({ name: z.string().trim().min(1).max(120), spiel: z.string().trim().min(1).max(10000).refine(v => v.includes("{{TIME}}"), "Spiel must contain {{TIME}}."), active: z.boolean().default(true) });
app.get("/api/health", (_q, s) => s.json({ ok: true }));
app.get("/api/templates", (_q, s) => { s.setHeader("Cache-Control", "no-store"); s.json({ templates: workbookStore.listPublic() }); });
app.get("/api/templates/:id", (q, s) => { const t = workbookStore.getPublic(q.params.id); if (!t)
    return s.status(404).json({ error: "Spiel not found." }); s.setHeader("Cache-Control", "no-store"); return s.json({ template: { id: t.id, name: t.name, spiel: t.spiel } }); });
function parseTimeApiUtc(value) {
    // TimeAPI.io returns dateTime without a timezone suffix. Requesting UTC lets us
    // safely interpret that value as UTC, then format the same instant in the
    // selected US IANA time zone in the React client.
    const normalized = value.replace(/(\\.\\d{3})\\d+$/, "$1");
    const epoch = Date.parse(`${normalized}Z`);
    return Number.isFinite(epoch) ? epoch : null;
}
app.get("/api/time", async (q, s) => {
    const zone = String(q.query.timeZone || "");
    if (!/^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+.-]+)+$/.test(zone)) {
        return s.status(400).json({ error: "Valid IANA time zone required." });
    }
    // Primary: TimeAPI.io. Its response contains dateTime, not unixTime.
    try {
        const response = await fetch("https://timeapi.io/api/Time/current/zone?timeZone=UTC", {
            signal: AbortSignal.timeout(8000), cache: "no-store"
        });
        if (!response.ok)
            throw new Error(`TimeAPI.io returned HTTP ${response.status}`);
        const data = await response.json();
        if (typeof data.dateTime !== "string")
            throw new Error("TimeAPI.io response did not contain dateTime.");
        const epochMs = parseTimeApiUtc(data.dateTime);
        if (epochMs === null)
            throw new Error("TimeAPI.io returned an invalid UTC timestamp.");
        return s.setHeader("Cache-Control", "no-store").json({ epochMs, source: "TimeAPI.io" });
    }
    catch (primaryError) {
        // Independent fallback. This service returns a Unix timestamp in unixtime.
        try {
            const response = await fetch(`https://gateway.timeapi.world/timezone/${encodeURIComponent(zone)}`, {
                signal: AbortSignal.timeout(8000), cache: "no-store"
            });
            if (!response.ok)
                throw new Error(`Fallback time service returned HTTP ${response.status}`);
            const data = await response.json();
            if (typeof data.unixtime !== "number" || !Number.isFinite(data.unixtime))
                throw new Error("Fallback time service returned an invalid unixtime.");
            const epochMs = data.unixtime * 1000;
            if (!Number.isFinite(epochMs))
                throw new Error("Fallback timestamp is invalid.");
            return s.setHeader("Cache-Control", "no-store").json({ epochMs, source: "TimeAPI World" });
        }
        catch (fallbackError) {
            console.error("Online time providers failed:", {
                primary: primaryError instanceof Error ? primaryError.message : String(primaryError),
                fallback: fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
            });
            return s.status(503).json({
                error: "Online time providers are unavailable. Computer time was not used.",
                details: "The primary and fallback online time services could not provide a valid timestamp."
            });
        }
    }
});
app.post("/api/admin/login", loginGuard, async (q, s) => {
    const pin = typeof q.body?.pin === "string" ? q.body.pin : "";
    if (pin.length < 8 || pin.length > 128) {
        q.failedLogin?.();
        q.session.destroy(() => { });
        return s.status(401).json({ error: "Incorrect PIN." });
    }
    const ok = await bcrypt.compare(pin, pinHash);
    if (!ok) {
        q.failedLogin?.();
        q.session.destroy(() => { });
        return s.status(401).json({ error: "Incorrect PIN." });
    }
    q.session.regenerate(err => { if (err)
        return s.status(500).json({ error: "Could not create session." }); q.session.isAdmin = true; q.session.save(e => { if (e)
        return s.status(500).json({ error: "Could not save session." }); return s.json({ authenticated: true }); }); });
});
app.post("/api/admin/logout", admin, (q, s) => q.session.destroy(() => { s.clearCookie("spiel_admin_session", { httpOnly: true, sameSite: "strict", secure: prod }); s.json({ authenticated: false }); }));
app.get("/api/admin/session", admin, (_q, s) => s.json({ authenticated: true }));
app.get("/api/admin/templates", admin, (_q, s) => { s.setHeader("Cache-Control", "no-store"); s.json({ templates: workbookStore.listAdmin() }); });
app.post("/api/admin/templates", admin, (q, s) => { const p = schema.safeParse(q.body); if (!p.success)
    return s.status(400).json({ error: p.error.issues[0]?.message || "Invalid template." }); return s.status(201).json({ template: workbookStore.save(p.data) }); });
app.put("/api/admin/templates/:id", admin, (q, s) => { const p = schema.safeParse(q.body); if (!p.success)
    return s.status(400).json({ error: p.error.issues[0]?.message || "Invalid template." }); const t = workbookStore.save({ id: q.params.id, ...p.data }); if (!t)
    return s.status(404).json({ error: "Template not found." }); return s.json({ template: t }); });
app.delete("/api/admin/templates/:id", admin, (q, s) => { if (!workbookStore.delete(q.params.id))
    return s.status(404).json({ error: "Template not found." }); return s.json({ deleted: true }); });
// Explicitly deny any attempt to browse the private data directory.
app.use("/data", (_req, res) => res.status(404).json({ error: "Not found." }));
// Excel workbook lives in /data, never in Vite public/ or Express static directory.
const here = path.dirname(fileURLToPath(import.meta.url)), dist = path.resolve(here, "../dist");
app.use(express.static(dist, { index: false, dotfiles: "deny" }));
app.get("*", (_q, s) => s.sendFile(path.join(dist, "index.html"), e => { if (e)
    s.status(404).send("Frontend build not found. Run npm run build."); }));
app.listen(PORT, () => console.log(`Region Spiel Manager listening on port ${PORT}`));
