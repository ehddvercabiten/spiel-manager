import { SubscriptionPanel, AdminPayments } from "./SubscriptionPanel";
import { useEffect, useRef, useState } from "react";
import {
  Clipboard,
  Copy,
  LockKeyhole,
  LogOut,
  ShieldCheck,
  Plus,
  Trash2,
  Pencil,
  Clock3,
  CheckCircle2,
  AlertCircle,
  Crown,
  LogIn,
} from "lucide-react";
type Template = {
    id: string;
    name: string;
    spiel: string;
    active: boolean;
};
type Region = {
    code: string;
    name: string;
    zone: string;
};
type OnlineClock = {
    epochMs: number;
    measuredAt: number;
    source: string;
};
const REGIONS: Region[] = [
    { code: "R001", name: "Pacific Northwest", zone: "America/Los_Angeles" },
    { code: "R009", name: "Southeast Region", zone: "America/New_York" },
    { code: "R006", name: "South Central / North Texas", zone: "America/Chicago" },
    { code: "R022", name: "Greater Georgia Region", zone: "America/New_York" },
    { code: "R013", name: "Mid-Atlantic", zone: "America/New_York" },
    { code: "R029", name: "Mid-South (Southern Gulf)", zone: "America/Chicago" },
    { code: "R033", name: "Western Mountain (Central Southwest)", zone: "America/Denver" },
    { code: "R015", name: "Greater Los Angeles / Central California", zone: "America/Los_Angeles" }
];
async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("Content-Type"))
        headers.set("Content-Type", "application/json");
    const response = await fetch(url, { ...init, credentials: "same-origin", headers });
    const data: {
        error?: string;
    } = await response.json().catch(() => ({ error: "Unexpected server response." }));
    if (!response.ok)
        throw new Error(data.error || `Request failed (${response.status})`);
    return data as T;
}
function formatTime(epochMs: number, zone: string, seconds = true): string {
    return new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        hour: "numeric",
        minute: "2-digit",
        ...(seconds ? { second: "2-digit" } : {}),
        hour12: true,
        timeZoneName: "short"
    }).format(new Date(epochMs));
}
export default function App() {
    const [tab, setTab] = useState<"selection" | "management" | "subscription">("selection");
    const [regionCode, setRegionCode] = useState("R001");
    const [templates, setTemplates] = useState<Pick<Template, "id" | "name">[]>([]);
    const [selectedId, setSelectedId] = useState("");
    const [generated, setGenerated] = useState("");
    const [clock, setClock] = useState<OnlineClock | null>(null);
    const [clockTick, setClockTick] = useState(0);
    const [timeLoading, setTimeLoading] = useState(true);
    const [spielLoading, setSpielLoading] = useState(false);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const [adminPin, setAdminPin] = useState("");
    const [adminUnlocked, setAdminUnlocked] = useState(false);
    const [adminMfaStep, setAdminMfaStep] = useState<"pin" | "setup" | "verify">("pin");
    const [totpSecret, setTotpSecret] = useState("");
    const [totpCode, setTotpCode] = useState("");
    const [freeLimit, setFreeLimit] = useState(300);
    const [limitSaved, setLimitSaved] = useState("");
    const [signedIn, setSignedIn] = useState(false);
    const [limitModal, setLimitModal] = useState(false);
    const [adminTemplates, setAdminTemplates] = useState<Template[]>([]);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formName, setFormName] = useState("");
    const [formSpiel, setFormSpiel] = useState("");
    const [formActive, setFormActive] = useState(true);
    const [copyState, setCopyState] = useState(false);
    const [timeCopyState, setTimeCopyState] = useState(false);
    const requestNumber = useRef(0);
    const shortcutCopyInProgress = useRef(false);
    const selectedRegion = REGIONS.find(r => r.code === regionCode) ?? REGIONS[0];

    // Derive the current online-synchronized time before effects that reference it.
    const liveEpoch = clock ? clock.epochMs + (performance.now() - clock.measuredAt) : null;

    // Intercept normal browser copy actions only when the selection comes from
    // the generated spiel or the displayed online time. This covers Ctrl+C,
    // Cmd+C, and the browser context-menu Copy command without counting copies
    // of unrelated page text. The Worker remains the source of truth for limits.
    useEffect(() => {
        const handleShortcutCopy = (event: ClipboardEvent) => {
            if (tab !== "selection" || shortcutCopyInProgress.current)
                return;

            const target = event.target;
            let selectedText = "";
            let copySource: "spiel" | "time" | null = null;

            if (target instanceof HTMLTextAreaElement && target.dataset.copySource === "spiel") {
                const start = target.selectionStart;
                const end = target.selectionEnd;
                selectedText = target.value.slice(start, end);
                if (selectedText && generated && selectedText.trim())
                    copySource = "spiel";
            }
            else {
                const selection = window.getSelection();
                const anchor = selection?.anchorNode;
                const anchorElement = anchor instanceof Element
                    ? anchor
                    : anchor?.parentElement;
                const sourceElement = anchorElement?.closest<HTMLElement>("[data-copy-source]");
                selectedText = selection?.toString() ?? "";
                if (selectedText.trim() && sourceElement?.dataset.copySource === "time" && liveEpoch !== null)
                    copySource = "time";
            }

            if (!copySource || !selectedText)
                return;

            // Stop the browser's immediate copy so the server can authorize it first.
            event.preventDefault();
            shortcutCopyInProgress.current = true;

            void (async () => {
                try {
                    await api("/api/usage/copy", { method: "POST" });
                    await navigator.clipboard.writeText(selectedText);
                    setError("");
                    if (copySource === "spiel") {
                        setCopyState(true);
                        window.setTimeout(() => setCopyState(false), 1800);
                    }
                    else {
                        setTimeCopyState(true);
                        window.setTimeout(() => setTimeCopyState(false), 1800);
                    }
                }
                catch (e) {
                    const copyError = (e as Error).message;
                    if (copyError.includes("copy limit") || copyError.includes("free limit") || copyError.includes("300-copy")) {
                        setLimitModal(true);
                        setTab("selection");
                    }
                    else if (copyError.toLowerCase().includes("sign in")) {
                        setLimitModal(true);
                        setTab("subscription");
                    }
                    else {
                        setError(copyError || "The selected text could not be copied.");
                    }
                }
                finally {
                    shortcutCopyInProgress.current = false;
                }
            })();
        };

        document.addEventListener("copy", handleShortcutCopy, true);
        return () => document.removeEventListener("copy", handleShortcutCopy, true);
    }, [tab, generated, liveEpoch]);
    // Admin UI state is deliberately not restored from browser storage after refresh.
    // The Worker must independently validate the completed MFA session.
    useEffect(() => {
        setAdminUnlocked(false);
        setAdminMfaStep("pin");
        setTotpCode("");
        setTotpSecret("");
    }, []);
    useEffect(() => {
        api<{
            user: {
                id: string;
            };
        }>("/api/auth/me").then(() => setSignedIn(true)).catch(() => setSignedIn(false));
    }, []);
    useEffect(() => {
        api<{
            templates: Pick<Template, "id" | "name">[];
        }>("/api/templates")
            .then(d => setTemplates(d.templates))
            .catch(e => setError((e as Error).message));
    }, []);
    // The API supplies the initial wall-clock time. performance.now() only measures
    // elapsed time between online synchronizations; the computer clock is never used.
    useEffect(() => {
        const timer = window.setInterval(() => {
            setClockTick((x: number) => x + 1);
        }, 1000);
        return () => {
            window.clearInterval(timer);
        };
    }, []);
    useEffect(() => {
        let cancelled = false;
        let refreshing = false;
        const fetchClock = async () => {
            if (refreshing)
                return;
            refreshing = true;
            if (!cancelled)
                setTimeLoading(true);
            try {
                const data = await api<{
                    epochMs: number;
                    source: string;
                }>(`/api/time?timeZone=${encodeURIComponent(selectedRegion.zone)}`);
                if (!Number.isFinite(data.epochMs))
                    throw new Error("Invalid online time response.");
                if (!cancelled) {
                    setClock({ epochMs: data.epochMs, measuredAt: performance.now(), source: data.source });
                    setError("");
                }
            }
            catch (e) {
                if (!cancelled) {
                    setClock(null);
                    setError((e as Error).message);
                }
            }
            finally {
                refreshing = false;
                if (!cancelled)
                    setTimeLoading(false);
            }
        };
        setClock(null);
        setGenerated("");
        setTimeLoading(true);
        void fetchClock();
        const interval = window.setInterval(() => {
            void fetchClock();
        }, 60000);
        return () => {
            cancelled = true;
            window.clearInterval(interval);
        };
    }, [selectedRegion.zone, regionCode]);
    // clockTick ensures a new render each second.
    void clockTick;
    async function selectTemplate(id: string) {
        const request = ++requestNumber.current;
        setSelectedId(id);
        setGenerated("");
        setMessage("");
        setCopyState(false);
        if (!id)
            return;
        if (!clock || timeLoading) {
            setError("Wait for the selected region's online time to load.");
            return;
        }
        setSpielLoading(true);
        setError("");
        try {
            const { template } = await api<{
                template: Template;
            }>(`/api/templates/${encodeURIComponent(id)}`);
            if (request !== requestNumber.current)
                return;
            // Use the current online-synchronized instant at generation time.
            const instant = clock.epochMs + (performance.now() - clock.measuredAt);
            const time = formatTime(instant, selectedRegion.zone, false);
            setGenerated(template.spiel.replaceAll("{{TIME}}", time));
            setMessage(`Spiel ready · ${selectedRegion.code} · ${selectedRegion.zone}`);
        }
        catch (e) {
            if (request === requestNumber.current)
                setError((e as Error).message);
        }
        finally {
            if (request === requestNumber.current)
                setSpielLoading(false);
        }
    }
    function changeRegion(code: string) {
        ++requestNumber.current;
        setRegionCode(code);
        setSelectedId("");
        setGenerated("");
        setSpielLoading(false);
        setMessage("");
        setError("");
    }
    async function copyTime() {
        if (liveEpoch === null)
            return;
        try {
            await api("/api/usage/copy", { method: "POST" });
            const currentTime = formatTime(liveEpoch, selectedRegion.zone);
            await navigator.clipboard.writeText(currentTime);
            setTimeCopyState(true);
            window.setTimeout(() => setTimeCopyState(false), 1800);
            setError("");
        }
        catch (e) {
            const message = (e as Error).message;
            if (message.includes("300-copy") || message.includes("copy limit") || message.includes("free limit")) {
                setLimitModal(true);
                setTab("selection");
            }
            else if (message.toLowerCase().includes("sign in")) {
                setLimitModal(true);
                setTab("subscription");
            }
            else
                setError(message || "Clipboard access was blocked. Select and copy the displayed time manually.");
        }
    }
    async function copySpiel() {
        try {
            await api("/api/usage/copy", { method: "POST" });
            await navigator.clipboard.writeText(generated);
            setCopyState(true);
            window.setTimeout(() => setCopyState(false), 1800);
        }
        catch (e) {
            const message = (e as Error).message;
            if (message.includes("300-copy") || message.includes("copy limit") || message.includes("free limit")) {
                setLimitModal(true);
                setTab("selection");
            }
            else if (message.toLowerCase().includes("sign in")) {
                setLimitModal(true);
                setTab("subscription");
            }
            else
                setError(message || "Clipboard access was blocked. Select and copy the text manually.");
        }
    }
    async function goSelection() {
        // Revoke either a full admin session or an unfinished MFA challenge.
        // This prevents a pending PIN challenge from lingering after leaving management.
        try {
            await api("/api/admin/logout", { method: "POST" });
        }
        catch {
            // Always clear local UI state even if the server is temporarily unavailable.
        }
        setTab("selection");
        setAdminUnlocked(false);
        setAdminPin("");
        setAdminTemplates([]);
        setEditingId(null);
        setError("");
        setMessage("");
    }
    async function loadAdminTemplates() {
        const data = await api<{
            templates: Template[];
        }>("/api/admin/templates");
        setAdminTemplates(data.templates);
    }
    /**
     * Opens the management area only when the Worker confirms a completed
     * PIN + authenticator session. A pending MFA challenge is never enough.
     */
    async function openManagement() {
        setError("");
        setMessage("");
        setAdminUnlocked(false);
        setAdminPin("");
        setAdminMfaStep("pin");
        setTotpCode("");
        setTotpSecret("");
        setAdminTemplates([]);

        try {
            await api("/api/admin/session");
            await loadAdminTemplates();
            setAdminUnlocked(true);
            const settings = await api<{ freeCopyLimit: number }>("/api/admin/settings");
            setFreeLimit(settings.freeCopyLimit);
        } catch {
            // Do not render admin data unless the server validates the full MFA session.
            setAdminUnlocked(false);
        }

        setTab("management");
    }
    async function unlock() {
        setError("");
        setMessage("");
        try {
            const result = await api<{
                requiresTotp: boolean;
                requiresSetup: boolean;
            }>("/api/admin/login", { method: "POST", body: JSON.stringify({ pin: adminPin }) });
            setAdminPin("");
            if (result.requiresSetup) {
                const setup = await api<{
                    secret: string;
                    otpauthUrl: string;
                }>("/api/admin/mfa/setup", { method: "POST" });
                setTotpSecret(setup.secret);
                setAdminMfaStep("setup");
            }
            else {
                setAdminMfaStep("verify");
            }
        }
        catch (e) {
            setAdminPin("");
            setError((e as Error).message);
        }
    }
    async function verifyAdminTotp() {
        setError("");
        try {
            await api("/api/admin/mfa/verify", { method: "POST", body: JSON.stringify({ code: totpCode }) });
            // Confirm that the newly issued full admin cookie is accepted before
            // showing any protected management content.
            await api("/api/admin/session");
            setTotpCode("");
            setAdminUnlocked(true);
            setAdminMfaStep("pin");
            await loadAdminTemplates();
            const settings = await api<{
                freeCopyLimit: number;
            }>("/api/admin/settings");
            setFreeLimit(settings.freeCopyLimit);
        }
        catch (e) {
            setError((e as Error).message);
        }
    }
    async function saveFreeLimit() {
        setError("");
        setLimitSaved("");
        try {
            const d = await api<{
                freeCopyLimit: number;
            }>("/api/admin/settings", { method: "PUT", body: JSON.stringify({ freeCopyLimit: freeLimit }) });
            setFreeLimit(d.freeCopyLimit);
            setLimitSaved("Free monthly copy limit updated.");
        }
        catch (e) {
            setError((e as Error).message);
        }
    }
    function clearForm() { setEditingId(null); setFormName(""); setFormSpiel(""); setFormActive(true); }
    function editTemplate(t: Template) { setEditingId(t.id); setFormName(t.name); setFormSpiel(t.spiel); setFormActive(t.active); }
    async function refreshPublicTemplates() {
        const data = await api<{
            templates: Pick<Template, "id" | "name">[];
        }>("/api/templates");
        setTemplates(data.templates);
        if (selectedId && !data.templates.some(t => t.id === selectedId)) {
            ++requestNumber.current;
            setSelectedId("");
            setGenerated("");
        }
    }
    async function saveTemplate() {
        setError("");
        setMessage("");
        try {
            const payload = { name: formName, spiel: formSpiel, active: formActive };
            await api(editingId ? `/api/admin/templates/${encodeURIComponent(editingId)}` : "/api/admin/templates", {
                method: editingId ? "PUT" : "POST", body: JSON.stringify(payload)
            });
            await loadAdminTemplates();
            await refreshPublicTemplates();
            clearForm();
            setMessage("Spiel saved directly to the Excel workbook.");
        }
        catch (e) {
            setError((e as Error).message);
        }
    }
    async function deleteTemplate(id: string) {
        if (!window.confirm("Delete this spiel template?"))
            return;
        setError("");
        setMessage("");
        try {
            await api(`/api/admin/templates/${encodeURIComponent(id)}`, { method: "DELETE" });
            await loadAdminTemplates();
            await refreshPublicTemplates();
            setMessage("Spiel deleted from Excel.");
        }
        catch (e) {
            setError((e as Error).message);
        }
    }
    return <div className="app-shell">

    <header className="header">

      <div className="brand"><div className="brand-icon"><Clipboard size={23}/></div><div><div className="eyebrow">SUPPORT OPERATIONS TOOL</div><h1>Spiel Manager</h1></div></div>

      <div className="online"><span /> ONLINE TIME</div>

    </header>

    <section className="intro"><div className="eyebrow">FAST · CONSISTENT · SIMPLE</div><h2>Keep every spiel up to date.</h2><p>Select a region to see its online time, then choose a spiel to generate your message.</p></section>

    <nav className="tabs">

      <button className={tab === "selection" ? "tab active" : "tab"} onClick={() => void goSelection()}><Clipboard size={16}/> Spiel Selection</button>

      {signedIn && (
        <button
          className={tab === "subscription" ? "tab active" : "tab"}
          onClick={() => {
            setError("");
            setMessage("");
            setTab("subscription");
          }}
        >
          <Crown size={16} />
          Premium
        </button>
      )}

      {!signedIn && (
        <button
          className={tab === "subscription" ? "tab active" : "tab"}
          onClick={() => {
            setError("");
            setMessage("");
            setTab("subscription");
          }}
        >
          <LogIn size={16} />
          Sign in / Register
        </button>
      )}

      <button
        className={tab === "management" ? "tab active" : "tab"}
        onClick={() => void openManagement()}
      >
        <LockKeyhole size={16} />
        Spiel Management
        <span className="lock-label">PIN PROTECTED</span>
      </button>

    </nav>

    {error && <div className="alert error"><AlertCircle size={17}/>{error}</div>}

    {message && <div className="alert success"><CheckCircle2 size={17}/>{message}</div>}

    {tab === "selection" && <main className="panel">

      <div className="panel-heading"><div><div className="eyebrow">SPIEL GENERATOR</div><h3>Select a region and spiel</h3></div><span className="live-tag"><span /> LIVE</span></div>

      <label className="region-field">Support region<select value={regionCode} onChange={e => changeRegion(e.target.value)}>{REGIONS.map(r => <option key={r.code} value={r.code}>{r.name}</option>)}</select></label>

      <div className="clock-strip"><div className="clock-icon"><Clock3 size={20}/></div><div><small>CURRENT TIME · {selectedRegion.zone}</small><strong data-copy-source="time">{timeLoading ? "Retrieving online time…" : liveEpoch === null ? "Online time unavailable" : formatTime(liveEpoch, selectedRegion.zone)}</strong></div><span className="time-source">{"ONLINE TIME"}</span><button className="quiet clock-copy" type="button" disabled={timeLoading || liveEpoch === null} onClick={() => void copyTime()}>{timeCopyState ? <CheckCircle2 size={15}/> : <Copy size={15}/>} {timeCopyState ? "Copied" : "Copy time"}</button></div>

      <label className="region-field">Saved spiel<select value={selectedId} disabled={timeLoading || !clock} onChange={e => void selectTemplate(e.target.value)}><option value="">Choose a spiel…</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>

      <label className="output-label">Generated spiel <span>READ ONLY</span></label>

      <textarea className="output" data-copy-source="spiel" value={spielLoading ? "Generating spiel…" : generated} readOnly placeholder="Select a region, wait for its online time, then choose a spiel."/>

      <div className="output-actions"><span className="helper">The spiel uses the online time when selected. Choose it again to refresh the inserted time.</span><button className="primary" disabled={!generated || spielLoading} onClick={() => void copySpiel()}>{copyState ? <CheckCircle2 size={17}/> : <Copy size={17}/>} {copyState ? "Copied" : "Copy spiel"}</button></div>

    </main>}

    {tab === "subscription" && <SubscriptionPanel onAuthChange={setSignedIn}/>}

    {tab === "management" && <main className="panel">

      {!adminUnlocked ? <div className="login-card"><div className="secure-icon"><ShieldCheck size={26}/></div><div className="eyebrow">RESTRICTED AREA</div><h3>Administrator Access</h3>{adminMfaStep === "pin" ? <><p>Enter the administrator PIN</p><form onSubmit={e => { e.preventDefault(); void unlock(); }}><input type="password" value={adminPin} onChange={e => setAdminPin(e.target.value)} placeholder="Administrator PIN" autoComplete="current-password" minLength={8}/><button className="primary full" disabled={adminPin.length < 8}>Continue</button></form></> : adminMfaStep === "setup" ? <><p>Bind Google Authenticator. In the app, choose Enter a setup key and use this secret.</p><code className="totp-secret">{totpSecret}</code><p className="hint-inline">Account: Spiel Manager Administrator · Time-based · 6 digits</p><input inputMode="numeric" autoComplete="one-time-code" value={totpCode} onChange={e => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="6-digit authenticator code"/><button className="primary full" disabled={totpCode.length !== 6} onClick={() => void verifyAdminTotp()}>Verify and bind authenticator</button></> : <><p>Enter the current 6-digit code from Google Authenticator.</p><input inputMode="numeric" autoComplete="one-time-code" value={totpCode} onChange={e => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="6-digit authenticator code"/><button className="primary full" disabled={totpCode.length !== 6} onClick={() => void verifyAdminTotp()}>Verify and unlock</button></>}</div>
                : <><div className="panel-heading"><div><div className="eyebrow">ADMINISTRATION</div><h3>Manage saved spiels</h3></div><button className="quiet" onClick={() => void goSelection()}><LogOut size={16}/> Lock & exit</button></div>

        <section className="admin-form limit-settings"><div className="eyebrow">USAGE CONTROLS</div><h3>Feature limits</h3><label>Free copies per user per calendar month<input type="number" min={1} max={100000} step={1} value={freeLimit} onChange={e => setFreeLimit(Number(e.target.value))}/></label><p className="hint-inline">Premium duration: 60 days · Subscription price: ₱49 (fixed)</p><div className="form-actions"><button className="primary" onClick={() => void saveFreeLimit()} disabled={!Number.isInteger(freeLimit) || freeLimit < 1 || freeLimit > 100000}>Save limit</button>{limitSaved && <span className="success-text">{limitSaved}</span>}</div></section>
        <AdminPayments />

        <div className="admin-form"><div className="field-grid"><label>Spiel name<input value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g. Coffeehouse - No Shot"/></label><label className="checkbox-field"><input type="checkbox" checked={formActive} onChange={e => setFormActive(e.target.checked)}/> Available to users</label></div><label>Spiel template <span className="hint-inline">Required placeholder: {"{{TIME}}"}</span><textarea value={formSpiel} onChange={e => setFormSpiel(e.target.value)} rows={5} placeholder="Called the coffeehouse at {{TIME}} to verify…"/></label><div className="form-actions"><button className="primary" onClick={() => void saveTemplate()} disabled={!formName.trim() || !formSpiel.includes("{{TIME}}")}><Plus size={16}/>{editingId ? "Save changes" : "Add spiel"}</button><button className="quiet" onClick={clearForm}>Clear</button></div></div>

        <div className="list-heading"><h4>Saved templates</h4><span>{adminTemplates.length} total</span></div><div className="template-list">{adminTemplates.map(t => <div className="template-row" key={t.id}><div><strong>{t.name}</strong><small>{t.active ? "Available" : "Hidden"} · ID {t.id}</small></div><div className="row-actions"><button className="icon-button" title="Edit" onClick={() => editTemplate(t)}><Pencil size={16}/></button><button className="icon-button danger" title="Delete" onClick={() => void deleteTemplate(t.id)}><Trash2 size={16}/></button></div></div>)}</div>

      </>}

    </main>}

    {limitModal && <div className="limit-modal-backdrop" role="presentation"><section className="limit-modal" role="dialog" aria-modal="true" aria-labelledby="limit-modal-title"><div className="secure-icon"><LockKeyhole size={24}/></div><h3 id="limit-modal-title">Your free copy limit has been reached</h3><p>{signedIn ? `You have used your ${freeLimit} free copies for this month.` : "Sign in or create an account to continue using the application."}</p><div className="form-actions"><button className="quiet" onClick={() => setLimitModal(false)}>Close</button><button className="primary" onClick={() => { setLimitModal(false); setTab("subscription"); }}> {signedIn ? "View Premium" : "Sign in / Register"}</button></div></section></div>}
    {/* <footer><p><strong>Time placeholder:</strong> {"{{TIME}}"} · Online time is retrieved independently for the selected region.</p></footer> */}

  </div>;
}
