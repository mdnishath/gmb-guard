'use client';

import { useState } from 'react';
import { api, type Listing, type ListingListParams } from '@/lib/client/api';
import { downloadText, fdt, mapsUrl, statusMeta, toCsv, uiStatus } from '@/lib/client/format';
import { useApp, errorMessage } from './app-context';
import { IC, Icon, Modal, Radio, Toggle } from './ui';

const COLS: Array<{ key: string; label: string; on: boolean }> = [
  { key: 'name', label: 'Name', on: true },
  { key: 'placeId', label: 'Place ID', on: true },
  { key: 'cid', label: 'CID', on: true },
  { key: 'status', label: 'Status', on: true },
  { key: 'city', label: 'City', on: true },
  { key: 'category', label: 'Category', on: true },
  { key: 'address', label: 'Address', on: false },
  { key: 'phone', label: 'Phone', on: false },
  { key: 'website', label: 'Website', on: false },
  { key: 'accountEmail', label: 'Account email', on: false },
  { key: 'tag', label: 'Tag', on: false },
  { key: 'url', label: 'Profile URL', on: true },
  { key: 'lastCheckedAt', label: 'Last checked', on: true },
  { key: 'lastError', label: 'Last error', on: false },
  { key: 'createdAt', label: 'Added', on: false },
];

export function ExportModal({
  onClose,
  filters,
  filteredCount,
  totalCount,
  selectedIds,
}: {
  onClose: () => void;
  filters: ListingListParams;
  filteredCount: number;
  totalCount: number;
  selectedIds: string[];
}) {
  const app = useApp();
  const [scope, setScope] = useState<'filtered' | 'all' | 'selected'>(selectedIds.length ? 'selected' : 'filtered');
  const [cols, setCols] = useState<Record<string, boolean>>(Object.fromEntries(COLS.map((c) => [c.key, c.on])));
  const [history, setHistory] = useState(false);
  const [busy, setBusy] = useState(false);

  const fetchAll = async (params: ListingListParams): Promise<Listing[]> => {
    const out: Listing[] = [];
    let page = 1;
    for (;;) {
      const r = await api.listings.list({ ...params, page, pageSize: 100 });
      out.push(...r.items);
      if (!r.pagination.hasNextPage) break;
      page++;
    }
    return out;
  };

  const run = async () => {
    setBusy(true);
    try {
      let items: Listing[];
      if (scope === 'all') items = await fetchAll({});
      else if (scope === 'filtered') items = await fetchAll({ search: filters.search, status: filters.status, city: filters.city, category: filters.category, pending: filters.pending, sortBy: filters.sortBy, sortDir: filters.sortDir });
      else {
        const all = await fetchAll({});
        const set = new Set(selectedIds);
        items = all.filter((l) => set.has(l.id));
      }
      const rows = items.map((l) => ({
        ...l,
        status: statusMeta(uiStatus(l)).l,
        url: mapsUrl(l.placeId, l.cid),
        lastCheckedAt: l.lastCheckedAt ? fdt(l.lastCheckedAt) : 'never',
        createdAt: fdt(l.createdAt),
      }));
      const columns = COLS.filter((c) => cols[c.key]).map((c) => ({ key: c.key, label: c.label }));
      const stamp = new Date().toISOString().slice(0, 10);
      downloadText(`gmb-listings-${stamp}.csv`, toCsv(rows, columns));

      if (history) {
        const ids = new Set(items.map((l) => l.id));
        const hist: Array<Record<string, unknown>> = [];
        let page = 1;
        for (;;) {
          const r = await api.auditLogs({ page, pageSize: 100 });
          for (const h of r.items) {
            if (!ids.has(h.listingId)) continue;
            hist.push({ name: h.listing?.name ?? '', placeId: h.listing?.placeId ?? '', from: statusMeta(h.previousStatus).l, to: statusMeta(h.newStatus).l, at: fdt(h.checkedAt) });
          }
          if (!r.pagination.hasNextPage || page >= 50) break;
          page++;
        }
        downloadText(
          `gmb-status-history-${stamp}.csv`,
          toCsv(hist, [
            { key: 'name', label: 'Name' },
            { key: 'placeId', label: 'Place ID' },
            { key: 'from', label: 'From' },
            { key: 'to', label: 'To' },
            { key: 'at', label: 'Changed at' },
          ]),
        );
      }
      app.toast('Export ready', `${items.length} listings exported as CSV.`);
      onClose();
    } catch (err) {
      app.toast('Export failed', errorMessage(err), { tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };

  const scopes = [
    { k: 'filtered' as const, l: 'Current view', sub: `${filteredCount} listings` },
    { k: 'all' as const, l: 'All businesses', sub: `${totalCount} listings` },
    ...(selectedIds.length ? [{ k: 'selected' as const, l: 'Selected rows', sub: `${selectedIds.length} listings` }] : []),
  ];

  return (
    <Modal title="Export businesses" onClose={onClose}>
      <div className="label" style={{ marginTop: 16 }}>Scope</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 8 }}>
        {scopes.map((o) => (
          <button key={o.k} onClick={() => setScope(o.k)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, background: scope === o.k ? 'var(--accentSoft)' : 'var(--surface)', border: `1px solid ${scope === o.k ? 'var(--accentBorder)' : 'var(--border)'}`, textAlign: 'left' }}>
            <Radio on={scope === o.k} />
            <span style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>{o.l}</span>
            <span className="tnum" style={{ fontSize: 11.5, color: 'var(--faint)' }}>
              {o.sub}
            </span>
          </button>
        ))}
      </div>
      <div className="label" style={{ marginTop: 16 }}>Columns</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        {COLS.map((c) => (
          <button key={c.key} onClick={() => setCols((x) => ({ ...x, [c.key]: !x[c.key] }))} className={`chip ${cols[c.key] ? 'active' : ''}`} style={{ fontSize: 11.5, padding: '5px 10px' }}>
            {c.label}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, padding: '11px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--well)' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700 }}>Include status history</div>
          <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>One row per status change, as a second CSV file</div>
        </div>
        <Toggle on={history} onChange={setHistory} label="Include history" />
      </div>
      <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', marginTop: 18 }}>
        <button onClick={onClose} className="btn btn-outline" style={{ fontSize: 13, padding: '9px 14px' }}>
          Cancel
        </button>
        <button onClick={() => void run()} disabled={busy} className="btn btn-primary" style={{ fontSize: 13, padding: '9px 16px' }}>
          {busy ? <Icon d={IC.spinner} size={12} stroke={3} spin color="#fff" /> : <Icon d={IC.download} size={13} stroke={2.2} />}
          Export CSV
        </button>
      </div>
    </Modal>
  );
}
