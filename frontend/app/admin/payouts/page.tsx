"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { Search, Landmark, ArrowUpRight, HelpCircle, ChevronLeft, ChevronRight } from "lucide-react";

const PAYOUT_TYPES = ["ALL", "DIRECT", "ANCHOR_FIAT"] as const;
type PayoutType = (typeof PAYOUT_TYPES)[number];

const PAGE_SIZES = [10, 25, 50] as const;

// Mock payouts matching anchor flow
const mockPayouts = [
  {
    id: "pay_01jm8v45px",
    planId: "plan_04nm8w90pa",
    beneficiary: "GBZV2I...1H4J",
    amount: 30000,
    currency: "NGN",
    anchor: "Stellar NGN Anchor (Link)",
    type: "ANCHOR_FIAT",
    status: "SETTLED",
    date: "2026-07-11T12:00:00Z",
  },
  {
    id: "pay_02km9v56py",
    planId: "plan_04nm8w90pa",
    beneficiary: "GDYU7H...8G5I",
    amount: 30000,
    currency: "KES",
    anchor: "Stellar KES Anchor (Pesalink)",
    type: "ANCHOR_FIAT",
    status: "PROCESSING",
    date: "2026-07-15T09:30:00Z",
  },
  {
    id: "pay_03lm1v23pz",
    planId: "plan_03lm1v23pz",
    beneficiary: "GBXP2Z...5N7Q",
    amount: 37500,
    currency: "BRL",
    anchor: "Stellar BRL Anchor (Pix)",
    type: "ANCHOR_FIAT",
    status: "FAILED",
    date: "2026-07-02T14:00:00Z",
  },
];

export default function AdminPayoutsPage() {
  const [payouts, setPayouts] = useState(mockPayouts);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState<PayoutType>("ALL");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);

  const filtered = useMemo(() => {
    return payouts.filter((p) => {
      const matchesSearch =
        p.id.toLowerCase().includes(search.toLowerCase()) ||
        p.beneficiary.toLowerCase().includes(search.toLowerCase()) ||
        p.planId.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === "ALL" || p.status === statusFilter;
      const matchesType = typeFilter === "ALL" || p.type === typeFilter;
      return matchesSearch && matchesStatus && matchesType;
    });
  }, [payouts, search, statusFilter, typeFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));

  // Kembali ke halaman 1 setiap kali hasil filter berubah. Tanpa ini, menyaring
  // dari 50 baris ke 3 sementara pengguna berada di halaman 4 memberi tabel
  // kosong yang terlihat seperti "tidak ada hasil".
  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, typeFilter, pageSize]);

  // Jaga halaman tetap dalam rentang kalau jumlah data menyusut dari sumber lain.
  const halamanAman = Math.min(page, totalPages);

  const paginated = useMemo(() => {
    const mulai = (halamanAman - 1) * pageSize;
    return filtered.slice(mulai, mulai + pageSize);
  }, [filtered, halamanAman, pageSize]);

  const handleRetryPayout = (payoutId: string) => {
    alert(`Retrying settlement for payout transaction: ${payoutId}`);
    setPayouts((prev) => prev.map((p) => (p.id === payoutId ? { ...p, status: "PROCESSING" } : p)));
  };

  return (
    <div className="animate-fade-in space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold text-white">Payout Settlements</h1>
        <p className="text-sm text-slate-500 mt-1">
          Monitor and retry fiat settlements initiated via Stellar Anchors.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by payout ID, plan ID, or beneficiary address…"
            className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-violet-500/50 transition-colors"
          />
        </div>
        <div className="flex items-center gap-1 p-1 rounded-xl bg-white/5 border border-white/10 flex-shrink-0">
          {PAYOUT_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              aria-pressed={typeFilter === t}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                typeFilter === t ? "bg-violet-500 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              {t === "ANCHOR_FIAT" ? "ANCHOR FIAT" : t}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 p-1 rounded-xl bg-white/5 border border-white/10 flex-shrink-0">
          {["ALL", "SETTLED", "PROCESSING", "FAILED"].map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                statusFilter === f ? "bg-violet-500 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white/[0.02] border border-white/5 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-white/5 bg-white/[0.02] text-slate-400 font-medium uppercase tracking-wider">
                <th className="p-4">Payout ID</th>
                <th className="p-4">Plan ID</th>
                <th className="p-4">Beneficiary</th>
                <th className="p-4">Amount</th>
                <th className="p-4">Anchor Partner</th>
                <th className="p-4">Status</th>
                <th className="p-4">Settlement Date</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {paginated.map((pay) => (
                <tr key={pay.id} className="hover:bg-white/[0.01] transition-colors text-slate-300">
                  <td className="p-4 font-mono font-medium text-violet-400">{pay.id}</td>
                  <td className="p-4 font-mono text-slate-400">
                    <Link href={`/admin/plans/${pay.planId}`} className="hover:underline flex items-center gap-1">
                      {pay.planId}
                      <ArrowUpRight size={10} />
                    </Link>
                  </td>
                  <td className="p-4 font-mono text-slate-400">{pay.beneficiary}</td>
                  <td className="p-4 font-semibold text-white">
                    ${pay.amount.toLocaleString()} <span className="text-[10px] text-slate-500">{pay.currency}</span>
                  </td>
                  <td className="p-4 flex items-center gap-2">
                    <Landmark size={12} className="text-slate-500" />
                    <span>{pay.anchor}</span>
                  </td>
                  <td className="p-4">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold border ${
                        pay.status === "SETTLED"
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          : pay.status === "PROCESSING"
                          ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
                          : "bg-red-500/10 text-red-400 border-red-500/20"
                      }`}
                    >
                      {pay.status}
                    </span>
                  </td>
                  <td className="p-4 text-slate-400">
                    {new Date(pay.date).toLocaleDateString()}
                  </td>
                  <td className="p-4 text-right">
                    {pay.status === "FAILED" && (
                      <button
                        onClick={() => handleRetryPayout(pay.id)}
                        className="px-2.5 py-1 rounded-lg bg-violet-500 text-white text-[11px] font-semibold hover:bg-violet-400 transition-colors"
                      >
                        Retry
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-500">
                    No settlements found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Paginasi */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-white/5 p-4 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <label htmlFor="page-size">Rows per page</label>
            <select
              id="page-size"
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="rounded-lg bg-white/5 border border-white/10 px-2 py-1 text-slate-200 focus:outline-none focus:border-violet-500/50"
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n} className="bg-slate-900">
                  {n}
                </option>
              ))}
            </select>
            <span className="text-slate-500">
              {filtered.length === 0
                ? "0 results"
                : `${(halamanAman - 1) * pageSize + 1}\u2013${Math.min(
                    halamanAman * pageSize,
                    filtered.length
                  )} of ${filtered.length}`}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={halamanAman <= 1}
              aria-label="Previous page"
              className="flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 disabled:opacity-40 disabled:cursor-not-allowed hover:text-white transition-colors"
            >
              <ChevronLeft size={12} />
              Prev
            </button>
            <span aria-live="polite">
              Page {halamanAman} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={halamanAman >= totalPages}
              aria-label="Next page"
              className="flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 disabled:opacity-40 disabled:cursor-not-allowed hover:text-white transition-colors"
            >
              Next
              <ChevronRight size={12} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
