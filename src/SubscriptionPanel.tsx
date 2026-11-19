import { useEffect, useState } from "react";

type Usage = {
  plan: "FREE" | "PREMIUM";
  copiesUsed: number;
  copyLimit: number | null;
  copiesRemaining: number | null;
  subscriptionExpiresAt: number | null;
};

type Payment = {
  id: string;
  amount: number;
  currency: string;
  payment_reference: string;
  status: string;
  submitted_at: number;
  rejection_reason?: string | null;
};

type User = {
  id: string;
  email: string;
  usage: Usage;
};

type PaymentsResponse = {
  payments?: Payment[];
  usage?: Usage;
  qrUrl?: string;
};

type AdminPaymentsResponse = {
  payments?: AdminPayment[];
};

type AdminPayment = Payment & {
  email: string;
};

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);

  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    ...init,
    headers,
    credentials: "same-origin",
  });

  const data = await response
    .json()
    .catch(() => ({ error: "Unexpected server response." }));

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data as T;
}

function getPaymentArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) {
    return value as T[];
  }

  return [];
}

function fileData(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read receipt image."));

    reader.readAsDataURL(file);
  });
}

export function SubscriptionPanel({
  onAuthChange,
}: {
  onAuthChange?: (signedIn: boolean) => void;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "register">("register");

  const [reference, setReference] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [receipt, setReceipt] = useState<File | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [qrUrl, setQrUrl] = useState("/payment/gcash-qr-placeholder.jpg");

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    const data = await request<PaymentsResponse>("/api/subscription/payments");
    const paymentRows = getPaymentArray<Payment>(data.payments);

    setPayments(paymentRows);

    if (typeof data.qrUrl === "string" && data.qrUrl.trim()) {
      setQrUrl(data.qrUrl);
    }

    if (data.usage) {
      setUser((currentUser) =>
        currentUser
          ? {
              ...currentUser,
              usage: data.usage!,
            }
          : currentUser,
      );
    }
  }

  useEffect(() => {
    let cancelled = false;

    request<{ user: User }>("/api/auth/me")
      .then((data) => {
        if (cancelled) return;

        setUser(data.user);
        onAuthChange?.(true);
      })
      .catch(() => {
        if (cancelled) return;

        setUser(null);
        onAuthChange?.(false);
      });

    return () => {
      cancelled = true;
    };
  }, [onAuthChange]);

  useEffect(() => {
    if (!user) return;

    void refresh().catch((requestError: unknown) => {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load payment history.",
      );
    });
    // refresh is intentionally triggered when the signed-in user changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function authenticate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const data = await request<{ user: User }>(`/api/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });

      setUser(data.user);
      onAuthChange?.(true);
      setPassword("");
      setNotice("You are signed in.");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to authenticate.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    try {
      await request("/api/auth/logout", { method: "POST" });
    } finally {
      setUser(null);
      onAuthChange?.(false);
      setPayments([]);
      setPassword("");
      setNotice("");
      setError("");
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!receipt) {
      setError("Please upload your GCash receipt.");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const receiptData = await fileData(receipt);

      await request("/api/subscription/payment", {
        method: "POST",
        body: JSON.stringify({
          reference,
          paidAt,
          receiptData,
          receiptMime: receipt.type,
        }),
      });

      setReference("");
      setPaidAt("");
      setReceipt(null);
      setNotice(
        "Payment submitted. Premium will activate after administrator verification.",
      );

      await refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to submit payment.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="subscription-panel">
      <div className="sub-heading">
        <div>
          <div className="sub-eyebrow">ACCOUNT & SUBSCRIPTION</div>
          <h3>Spiel Manager Premium</h3>
          <p>₱49 for 60 days · Manual payment · No automatic renewal</p>
        </div>

        {user && (
          <button className="sub-secondary" onClick={() => void logout()}>
            Sign out
          </button>
        )}
      </div>

      {error && <div className="sub-error">{error}</div>}
      {notice && <div className="sub-notice">{notice}</div>}

      {!user ? (
        <form className="sub-auth" onSubmit={authenticate}>
          <div className="sub-copy">
            <strong>
              {mode === "register" ? "Create your account" : "Welcome back"}
            </strong>
            <span>
              Register or sign in to track your monthly copy allowance and
              subscription.
            </span>
          </div>

          <input
            type="email"
            required
            maxLength={254}
            placeholder="Email address"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />

          <input
            type="password"
            required
            minLength={10}
            maxLength={128}
            placeholder="Password (at least 10 characters)"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />

          <button disabled={busy}>
            {busy
              ? "Please wait…"
              : mode === "register"
                ? "Create account"
                : "Sign in"}
          </button>

          <button
            type="button"
            className="sub-link"
            onClick={() =>
              setMode((currentMode) =>
                currentMode === "register" ? "login" : "register",
              )
            }
          >
            {mode === "register"
              ? "Already registered? Sign in"
              : "Need an account? Register"}
          </button>
        </form>
      ) : (
        <>
          <div className="sub-status">
            <div>
              <span>ACCOUNT</span>
              <strong>{user.email}</strong>
            </div>

            <div>
              <span>PLAN</span>
              <strong>{user.usage.plan}</strong>
            </div>

            <div>
              <span>THIS MONTH</span>
              <strong>
                {user.usage.copiesUsed}
                {user.usage.copyLimit
                  ? ` / ${user.usage.copyLimit}`
                  : " · Unlimited"}
              </strong>
            </div>
          </div>

          {user.usage.plan === "PREMIUM" ? (
            <div className="sub-notice">
              Premium active until{" "}
              {user.usage.subscriptionExpiresAt
                ? new Date(
                    user.usage.subscriptionExpiresAt * 1000,
                  ).toLocaleString()
                : "the expiry date is unavailable"}
              .
            </div>
          ) : (
            <div className="sub-payment-grid">
              <div className="sub-qr-card">
                <strong>1. Scan and pay ₱49</strong>
                <img
                  src={qrUrl}
                  alt="GCash payment QR placeholder"
                  onError={(event) => {
                    event.currentTarget.onerror = null;
                    event.currentTarget.src =
                      "/payment/gcash-qr-placeholder.jpg";
                  }}
                />
                <small>
                  DEMO QR — replace with an approved receiving QR before
                  accepting payments. Verify the recipient before sending.
                </small>
              </div>

              <form className="sub-payment-form" onSubmit={submit}>
                <strong>2. Submit payment for review</strong>

                <label>
                  GCash transaction reference
                  <input
                    required
                    minLength={6}
                    maxLength={100}
                    value={reference}
                    onChange={(event) => setReference(event.target.value)}
                    placeholder="Transaction reference"
                  />
                </label>

                <label>
                  Payment date and time
                  <input
                    type="datetime-local"
                    value={paidAt}
                    onChange={(event) => setPaidAt(event.target.value)}
                  />
                </label>

                <label>
                  Receipt image
                  <input
                    required
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(event) =>
                      setReceipt(event.target.files?.[0] ?? null)
                    }
                  />
                  <small>PNG, JPG or WebP. Maximum 5 MB.</small>
                </label>

                <button disabled={busy}>
                  {busy ? "Submitting…" : "Submit for admin approval"}
                </button>
              </form>
            </div>
          )}

          <div className="sub-history">
            <strong>Payment history</strong>

            {payments.length === 0 ? (
              <p>No payment submissions yet.</p>
            ) : (
              payments.map((payment) => (
                <div className="sub-payment-row" key={payment.id}>
                  <span>
                    ₱{payment.amount} · {payment.payment_reference}
                    <small>
                      {new Date(
                        payment.submitted_at * 1000,
                      ).toLocaleString()}
                    </small>
                  </span>

                  <b className={`sub-${payment.status.toLowerCase()}`}>
                    {payment.status}
                  </b>

                  {payment.rejection_reason && (
                    <small>{payment.rejection_reason}</small>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </section>
  );
}

export function AdminPayments() {
  const [rows, setRows] = useState<AdminPayment[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function load() {
    try {
      const data = await request<AdminPaymentsResponse>(
        "/api/admin/payments",
      );

      if (!Array.isArray(data.payments)) {
        setRows([]);
        setError(
          "The payment API returned an unexpected response. Expected a payments array.",
        );
        return;
      }

      setRows(data.payments);
      setError("");
    } catch (requestError) {
      setRows([]);
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load payment submissions.",
      );
    }
  }

  useEffect(() => {
    void load();
    // load is called on mount; refresh is also available through the button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function review(
    id: string,
    action: "approve" | "reject",
  ) {
    let reason = "";

    if (action === "reject") {
      reason =
        window.prompt(
          "Reason for rejection:",
          "Payment could not be verified.",
        ) || "";

      if (!reason.trim()) return;
    }

    if (
      action === "approve" &&
      !window.confirm(
        "Have you verified the ₱49 payment in your GCash transaction history? Approve this subscription?",
      )
    ) {
      return;
    }

    setBusy(id);
    setError("");

    try {
      await request(`/api/admin/payments/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });

      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to update the payment.",
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="admin-payments">
      <div className="sub-admin-head">
        <div>
          <div className="sub-eyebrow">SUBSCRIPTION MANAGEMENT</div>
          <h3>Payment approvals</h3>
        </div>

        <button className="sub-secondary" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {error && <div className="sub-error">{error}</div>}

      {rows.length === 0 ? (
        !error && <p>No payment submissions.</p>
      ) : (
        rows.map((payment) => (
          <article className="sub-review-card" key={payment.id}>
            <div>
              <strong>{payment.email}</strong>
              <span>
                ₱{payment.amount} · {payment.payment_reference}
              </span>
              <small>
                Submitted{" "}
                {new Date(
                  payment.submitted_at * 1000,
                ).toLocaleString()}
              </small>
              <b className={`sub-${String(payment.status).toLowerCase()}`}>
                {payment.status}
              </b>
            </div>

            <div className="sub-review-actions">
              <a
                href={`/api/admin/payments/${encodeURIComponent(payment.id)}/receipt`}
                target="_blank"
                rel="noreferrer"
              >
                View receipt
              </a>

              {payment.status === "PENDING" && (
                <>
                  <button
                    disabled={busy === payment.id}
                    onClick={() => void review(payment.id, "approve")}
                  >
                    Approve
                  </button>

                  <button
                    className="sub-reject"
                    disabled={busy === payment.id}
                    onClick={() => void review(payment.id, "reject")}
                  >
                    Reject
                  </button>
                </>
              )}
            </div>
          </article>
        ))
      )}
    </div>
  );
}
