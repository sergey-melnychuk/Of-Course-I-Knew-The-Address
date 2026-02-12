import { useCallback, useEffect, useRef, useState } from "react";

function useClickOutside(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [ref, onClose]);
}

interface Deposit {
  id: number;
  user: string;
  salt: string;
  address: string;
  balance: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface Filters {
  user: string;
  address: string;
  statuses: Set<string>;
}

const ALL_STATUSES = ["pending", "proxied", "routed"] as const;

const API = "/api";
const PAGE_SIZES = [10, 25, 50, 100] as const;
const REFRESH_INTERVALS = [0, 10, 30, 60, 120] as const; // 0 = off

export default function App() {
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const [refreshIntervalSeconds, setRefreshIntervalSeconds] = useState<number>(REFRESH_INTERVALS[0]);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ x: number; y: number } | null>(null);
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const statusDropdownRef = useRef<HTMLTableDataCellElement>(null);
  useClickOutside(statusDropdownRef, () => setStatusDropdownOpen(false));
  const [filters, setFilters] = useState<Filters>({
    user: "",
    address: "",
    statuses: new Set(),
  });

  // New deposit form
  const [userInput, setUserInput] = useState("");
  const [creating, setCreating] = useState(false);
  const isValidAddress = /^0x[0-9a-fA-F]{40}$/.test(userInput);

  const fetchDeposits = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(pageSize + 1)); // fetch one extra to detect next page
      params.set("offset", String(page * pageSize));
      if (filters.user) params.set("user", filters.user);
      if (filters.address) params.set("address", filters.address);
      if (filters.statuses.size > 0 && filters.statuses.size < ALL_STATUSES.length)
        params.set("status", [...filters.statuses].join(","));

      const res = await fetch(`${API}/deposits?${params}`);
      if (!res.ok) throw new Error(await res.text());
      const data: Deposit[] = await res.json();

      setHasMore(data.length > pageSize);
      setDeposits(data.slice(0, pageSize));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filters]);

  useEffect(() => {
    fetchDeposits();
  }, [fetchDeposits]);

  // Re-fetch visible data after every N seconds when refresh interval is set
  useEffect(() => {
    if (refreshIntervalSeconds <= 0) return;
    const id = setInterval(() => {
      fetchDeposits();
    }, refreshIntervalSeconds * 1000);
    return () => clearInterval(id);
  }, [refreshIntervalSeconds, fetchDeposits]);

  const updateFilter = (key: keyof Filters, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(0);
  };

  const toggleStatus = (s: string) => {
    setFilters((f) => {
      const next = new Set(f.statuses);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return { ...f, statuses: next };
    });
    setPage(0);
  };

  const act = async (id: number, label: string, address: string) => {
    setActing(id);
    try {
      const res = await fetch(`${API}/route`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ address }),
      });
      if (!res.ok) throw new Error(await res.text());
      await fetchDeposits();
    } catch (e) {
      setError(`${label} failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setActing(null);
    }
  };

  const createDeposit = async () => {
    setCreating(true);
    try {
      const res = await fetch(`${API}/deposits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: userInput }),
      });
      if (!res.ok) throw new Error(await res.text());
      setUserInput("");
      await fetchDeposits();
    } catch (e) {
      setError(`Create failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setCreating(false);
    }
  };

  const copy = async (e: React.MouseEvent, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard API requires HTTPS; fall back to execCommand for HTTP.
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setToast({ x: e.clientX, y: e.clientY });
    setTimeout(() => setToast(null), 1200);
  };

  const truncate = (hex: string) =>
    hex.length > 16 ? `${hex.slice(0, 10)}…${hex.slice(-8)}` : hex;

  const weiToEth = (hexWei: string): string => {
    const raw = hexWei.startsWith("0x") ? hexWei.slice(2) : hexWei;
    if (!raw || /^0+$/i.test(raw)) return "0";
    const wei = BigInt("0x" + raw);
    const div = BigInt(10) ** BigInt(18);
    const int = wei / div;
    const frac = (wei % div).toString().padStart(18, "0").replace(/0+$/, "");
    if (!frac) return int.toString();
    const decimals = frac.slice(0, 6);
    return `${int}.${decimals}`;
  };

  const statusColor: Record<string, string> = {
    pending:
      "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    proxied:
      "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    routed:
      "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  };

  const inputClass =
    "w-full rounded border border-zinc-300 bg-white px-3 py-1.5 font-mono text-xs placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:placeholder:text-zinc-600";

  return (
    <div className="min-h-screen bg-zinc-50 p-8 dark:bg-zinc-950">
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">
          Deposits
        </h1>

        {/* Add deposit */}
        <div className="mb-6 flex gap-3">
          <input
            type="text"
            placeholder="0x… (user address, 20 bytes)"
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && isValidAddress && !creating) createDeposit();
            }}
            className="flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-2 font-mono text-sm placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:placeholder:text-zinc-600"
          />
          <button
            onClick={createDeposit}
            disabled={!isValidAddress || creating}
            className="rounded-lg bg-zinc-900 px-5 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {creating ? "Creating…" : "Add Deposit"}
          </button>
        </div>

        {/* Grid */}
        <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-3 font-medium">ID</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Address</th>
                <th className="px-4 py-3 font-medium">Balance</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
              {/* Filter row */}
              <tr className="border-t border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
                <td className="px-4 py-2" />
                <td className="relative px-4 py-2" ref={statusDropdownRef}>
                  <button
                    type="button"
                    onClick={() => setStatusDropdownOpen((o) => !o)}
                    className="flex min-w-[7rem] items-center justify-between gap-1 rounded border border-zinc-300 bg-white px-3 py-1.5 text-left text-xs dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    <span className="truncate">
                      {filters.statuses.size === 0 || filters.statuses.size === ALL_STATUSES.length
                        ? "All"
                        : [...filters.statuses].sort().join(", ")}
                    </span>
                    <svg
                      className={`h-3 w-3 shrink-0 transition ${statusDropdownOpen ? "rotate-180" : ""}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {statusDropdownOpen && (
                    <div className="absolute left-4 top-full z-10 mt-0.5 min-w-[7rem] rounded border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                      {ALL_STATUSES.map((s) => (
                        <label
                          key={s}
                          className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                          <input
                            type="checkbox"
                            checked={filters.statuses.has(s)}
                            onChange={() => toggleStatus(s)}
                            className="h-3.5 w-3.5 rounded border-zinc-300"
                          />
                          {s}
                        </label>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2">
                  <input
                    type="text"
                    placeholder="0x…"
                    value={filters.user}
                    onChange={(e) => updateFilter("user", e.target.value)}
                    className={inputClass}
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    type="text"
                    placeholder="0x…"
                    value={filters.address}
                    onChange={(e) => updateFilter("address", e.target.value)}
                    className={inputClass}
                  />
                </td>
                <td className="px-4 py-2" />
                <td className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                    Loading…
                  </td>
                </tr>
              ) : deposits.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                    No deposits found.
                  </td>
                </tr>
              ) : (
                deposits.map((d) => (
                  <tr
                    key={d.id}
                    className="bg-white hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                  >
                    <td className="px-4 py-3 font-mono tabular-nums">
                      {d.id}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColor[d.status] ?? "bg-zinc-100 text-zinc-800"}`}
                      >
                        {d.status}
                      </span>
                    </td>
                    <td
                      className="cursor-pointer px-4 py-3 font-mono text-xs hover:text-blue-600 dark:hover:text-blue-400"
                      title={d.user}
                      onClick={(e) => copy(e, d.user)}
                    >
                      {truncate(d.user)}
                    </td>
                    <td
                      className="cursor-pointer px-4 py-3 font-mono text-xs hover:text-blue-600 dark:hover:text-blue-400"
                      title={d.address}
                      onClick={(e) => copy(e, d.address)}
                    >
                      {truncate(d.address)}
                    </td>
                    <td
                      className="cursor-pointer px-4 py-3 font-mono text-xs tabular-nums hover:text-blue-600 dark:hover:text-blue-400"
                      title={`${weiToEth(d.balance)} ETH`}
                      onClick={(e) => copy(e, d.balance)}
                    >
                      {weiToEth(d.balance)} ETH
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Actions
                        status={d.status}
                        busy={acting === d.id}
                        onDeploy={() => act(d.id, "Deploy", d.address)}
                        onRoute={() => act(d.id, "Route", d.address)}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Paging */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-500">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span>Rows per page</span>
              <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(0);
              }}
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              {PAGE_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            </div>
            <div className="flex items-center gap-2">
              <span>Refresh balance every</span>
              <select
                value={refreshIntervalSeconds}
                onChange={(e) => setRefreshIntervalSeconds(Number(e.target.value))}
                className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              >
                <option value={0}>Off</option>
                {REFRESH_INTERVALS.filter((s) => s > 0).map((s) => (
                  <option key={s} value={s}>
                    {s}s
                  </option>
                ))}
              </select>
            </div>
          </div>
          <span>
            {deposits.length > 0
              ? `${page * pageSize + 1}–${page * pageSize + deposits.length}`
              : "0"}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => p - 1)}
              disabled={page === 0}
              className="rounded border border-zinc-300 px-3 py-1 transition hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Prev
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!hasMore}
              className="rounded border border-zinc-300 px-3 py-1 transition hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 animate-[fadeDown_1.2s_ease-out_forwards] rounded bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900"
          style={{ left: toast.x, top: toast.y + 4 }}
        >
          Copied
        </div>
      )}

      {error && <ErrorModal message={error} onClose={() => setError(null)} />}
    </div>
  );
}

function ErrorModal({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      ref={backdropRef}
      onClick={(e) => e.target === backdropRef.current && onClose()}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in"
    >
      <div className="mx-4 w-full max-w-md rounded-xl border border-red-200 bg-white p-6 shadow-2xl dark:border-red-900 dark:bg-zinc-900">
        <div className="mb-3 flex items-center gap-2 text-red-600 dark:text-red-400">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-5 w-5 shrink-0"
          >
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z"
              clipRule="evenodd"
            />
          </svg>
          <h2 className="text-sm font-semibold">Error</h2>
        </div>
        <p className="mb-5 break-words text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          {message}
        </p>
        <button
          onClick={onClose}
          className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

function Actions({
  status,
  busy,
  onDeploy,
  onRoute,
}: {
  status: string;
  busy: boolean;
  onDeploy: () => void;
  onRoute: () => void;
}) {
  if (status === "routed") return null;

  const base =
    "rounded px-3 py-1 text-xs font-medium transition disabled:opacity-50";

  return (
    <div className="flex justify-end gap-2">
      {status === "pending" && (
        <button
          className={`${base} bg-blue-600 text-white hover:bg-blue-700`}
          onClick={onDeploy}
          disabled={busy}
        >
          {busy ? "…" : "Deploy"}
        </button>
      )}
      {(status === "pending" || status === "proxied") && (
        <button
          className={`${base} bg-emerald-600 text-white hover:bg-emerald-700`}
          onClick={onRoute}
          disabled={busy}
        >
          {busy ? "…" : "Route"}
        </button>
      )}
    </div>
  );
}
