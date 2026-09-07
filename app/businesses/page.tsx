'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useApp, errorMessage } from '@/components/app-context';
import { ExportModal } from '@/components/export-modal';
import { ListingModal } from '@/components/listing-modal';
import { Checkbox, EmptyState, IC, Icon, Pager, Skeleton, StatusPill } from '@/components/ui';
import { api, type Listing, type ListingListParams, type Pagination, type Stats } from '@/lib/client/api';
import { fdate, locationLine, mapsUrl, relTime, uiStatus, type UiStatus } from '@/lib/client/format';

type View = 'all' | 'susp' | 'attn' | 'recent';
type StatusFilter = '' | UiStatus;

const COL_DEFS: Array<[string, string]> = [
  ['city', 'City'],
  ['cat', 'Category'],
  ['url', 'Profile URL'],
  ['checked', 'Last checked'],
  ['changed', 'Last updated'],
];

export default function BusinessesPage() {
  return (
    <Suspense fallback={null}>
      <Businesses />
    </Suspense>
  );
}

function Businesses() {
  const app = useApp();
  const router = useRouter();
  const sp = useSearchParams();

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [fStatus, setFStatus] = useState<StatusFilter>('');
  const [fCity, setFCity] = useState('');
  const [fCat, setFCat] = useState('');
  const [view, setView] = useState<View>('all');
  const [page, setPage] = useState(1);
  const [ps, setPs] = useState(25);
  const [sortBy, setSortBy] = useState('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [cols, setCols] = useState<Record<string, boolean>>({ city: true, cat: true, url: true, checked: true, changed: true });
  const [colsOpen, setColsOpen] = useState(false);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [menuRow, setMenuRow] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<Record<string, boolean>>({});
  const [just, setJust] = useState<Record<string, boolean>>({});
  const [items, setItems] = useState<Listing[] | null>(null);
  const [pag, setPag] = useState<Pagination | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const reqId = useRef(0);

  // deep links: ?listing=id, ?add=1, ?export=1
  useEffect(() => {
    const l = sp.get('listing');
    if (l) app.openDrawer(l);
    if (sp.get('add')) setAddOpen(true);
    if (sp.get('export')) setExportOpen(true);
    if (l || sp.get('add') || sp.get('export')) router.replace('/businesses');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const params = useMemo<ListingListParams>(() => {
    const p: ListingListParams = { page, pageSize: ps, search: debounced, city: fCity, category: fCat, sortBy, sortDir };
    if (fStatus === 'pend') p.pending = true;
    else if (fStatus === 'unver') p.hasError = true;
    else if (fStatus) {
      p.status = fStatus === 'live' ? 'ACTIVE' : fStatus === 'susp' ? 'SUSPENDED' : 'CLOSED';
      if (fStatus === 'live') p.pending = false;
    }
    return p;
  }, [page, ps, debounced, fCity, fCat, fStatus, sortBy, sortDir]);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    try {
      const [r, s] = await Promise.all([api.listings.list(params), api.listings.stats()]);
      if (id !== reqId.current) return;
      setItems(r.items);
      setPag(r.pagination);
      setStats(s);
    } catch (err) {
      if (id !== reqId.current) return;
      app.toast('Could not load listings', errorMessage(err), { tone: 'bad' });
      setItems([]);
    }
  }, [params, app]);

  useEffect(() => {
    void load();
  }, [load, app.refreshKey]);

  const N = stats?.total ?? 0;
  const pending = stats?.pending ?? 0;
  const liveCount = Math.max(0, (stats?.distribution.ACTIVE ?? 0) - pending);
  const chips: Array<[StatusFilter, string, number]> = [
    ['', 'All', N],
    ['live', 'Live', liveCount],
    ['susp', 'Suspended', stats?.distribution.SUSPENDED ?? 0],
    ['closed', 'Closed', stats?.distribution.CLOSED ?? 0],
    ['pend', 'Pending', pending],
    ['unver', 'Unverified', stats?.monitoring.withErrors ?? 0],
  ];

  const applyView = (v: View) => {
    setView(v);
    setPage(1);
    if (v === 'all') {
      setFStatus('');
      setSearch('');
    } else if (v === 'susp') setFStatus('susp');
    else if (v === 'attn') setFStatus('susp');
    else if (v === 'recent') {
      setFStatus('');
      setSortBy('updatedAt');
      setSortDir('desc');
    }
  };

  const hasFilters = !!(debounced || fStatus || fCity || fCat);
  const clearFilters = () => {
    setSearch('');
    setFStatus('');
    setFCity('');
    setFCat('');
    setPage(1);
    setView('all');
  };

  const flash = (id: string) => {
    setJust((j) => ({ ...j, [id]: true }));
    setTimeout(() => setJust((j) => {
      const c = { ...j };
      delete c[id];
      return c;
    }), 1500);
  };

  const rowCheck = async (b: Listing, e?: MouseEvent) => {
    e?.stopPropagation();
    if (rowBusy[b.id]) return;
    setRowBusy((x) => ({ ...x, [b.id]: true }));
    try {
      const r = await api.listings.checkOne(b.id);
      setItems((list) => (list ? list.map((x) => (x.id === b.id ? r.listing : x)) : list));
      flash(b.id);
      if (r.result?.error) app.toast('Check failed', `"${b.name}": ${r.result.error}`, { tone: 'warn' });
      else if (r.result?.changed) app.toast('Status changed', `"${b.name}" is now ${r.listing.currentStatus === 'ACTIVE' ? 'Live' : r.listing.currentStatus === 'SUSPENDED' ? 'Suspended' : 'Closed'}.`, { tone: r.listing.currentStatus === 'ACTIVE' ? 'ok' : 'bad' });
      else app.toast('Check complete', `"${b.name}" — no status change.`);
      const s = await api.listings.stats();
      setStats(s);
    } catch (err) {
      app.toast('Check failed', errorMessage(err), { tone: 'bad' });
    } finally {
      setRowBusy((x) => {
        const c = { ...x };
        delete c[b.id];
        return c;
      });
    }
  };

  const delBiz = (b: Listing) => {
    setMenuRow(null);
    app.askConfirm({
      title: `Delete "${b.name}"?`,
      msg: 'This removes the listing and its check history from GMB Guard. The Google Business Profile itself is not affected.',
      label: 'Delete listing',
      onYes: async () => {
        try {
          await api.listings.remove(b.id);
          app.toast('Listing deleted', `"${b.name}" was removed.`, { tone: 'na' });
          app.bumpRefresh();
        } catch (err) {
          app.toast('Delete failed', errorMessage(err), { tone: 'bad' });
        }
      },
    });
  };

  const selIds = Object.keys(sel).filter((k) => sel[k]);
  const bulk = async (kind: 'check' | 'export' | 'del') => {
    if (kind === 'export') {
      setExportOpen(true);
      return;
    }
    if (kind === 'check') {
      setBulkBusy(true);
      setRowBusy((x) => ({ ...x, ...Object.fromEntries(selIds.map((id) => [id, true])) }));
      try {
        const r = await api.listings.checkMany(selIds);
        app.toast('Check complete', `${r.checked} listings checked — ${r.changed} status change${r.changed === 1 ? '' : 's'}${r.errors ? `, ${r.errors} errors` : ''}.`, { tone: r.changed ? 'warn' : 'ok' });
        setSel({});
        app.bumpRefresh();
      } catch (err) {
        app.toast('Check failed', errorMessage(err), { tone: 'bad' });
      } finally {
        setBulkBusy(false);
        setRowBusy({});
      }
      return;
    }
    app.askConfirm({
      title: `Delete ${selIds.length} listings?`,
      msg: 'This removes the selected listings and their history from GMB Guard. Google profiles are not affected.',
      label: `Delete ${selIds.length}`,
      onYes: async () => {
        let n = 0;
        for (const id of selIds) {
          try {
            await api.listings.remove(id);
            n++;
          } catch {
            /* continue */
          }
        }
        app.toast(`${n} listings deleted`, '', { tone: 'na' });
        setSel({});
        app.bumpRefresh();
      },
    });
  };

  const sortBtn = (key: string, label: string) => (
    <button
      onClick={() => {
        setSortDir(sortBy === key ? (sortDir === 'asc' ? 'desc' : 'asc') : 'asc');
        setSortBy(key);
      }}
      className={`sort-btn ${sortBy === key ? 'active' : ''}`}
    >
      <span>{label}</span>
      <span>{sortBy === key ? (sortDir === 'asc' ? '↑' : '↓') : ''}</span>
    </button>
  );

  const tc = ['34px', 'minmax(210px,2.2fr)'];
  if (cols.city) tc.push('110px');
  if (cols.cat) tc.push('120px');
  if (cols.url) tc.push('46px');
  tc.push('126px');
  if (cols.checked) tc.push('118px');
  if (cols.changed) tc.push('108px');
  tc.push('40px');
  const tableCols = tc.join(' ');
  const tableMinW = tc.length > 7 ? 900 : 700;

  const allSel = !!items && items.length > 0 && items.every((b) => sel[b.id]);
  const total = pag?.total ?? 0;
  const start = total ? (page - 1) * ps + 1 : 0;
  const end = Math.min(page * ps, total);
  const sm = app.vw === 'sm';
  const firstRun = stats !== null && N === 0;

  return (
    <div className="page" style={{ maxWidth: 1440 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h1 className="h1">Businesses</h1>
          <p className="sub">
            {pag ? `${total} of ${N}` : '…'} listings
          </p>
        </div>
        <button onClick={() => setAddOpen(true)} className="btn btn-primary">
          <Icon d={IC.plus} size={13} stroke={2.4} />
          <span>Add business</span>
        </button>
        <Link href="/import" className="btn btn-outline" style={{ textDecoration: 'none' }}>
          <Icon d={IC.upload} size={13} stroke={2.2} />
          <span>Import</span>
        </Link>
        <button onClick={() => setExportOpen(true)} className="btn btn-outline">
          <Icon d={IC.download} size={13} stroke={2.2} />
          <span>Export</span>
        </button>
      </div>

      <div className="seg" style={{ marginBottom: 12 }}>
        {(
          [
            ['all', 'All listings'],
            ['susp', 'Suspended only'],
            ['attn', 'Needs attention'],
            ['recent', 'Recently changed'],
          ] as Array<[View, string]>
        ).map(([k, l]) => (
          <button key={k} onClick={() => applyView(k)} className={`seg-btn ${view === k ? 'active' : ''}`}>
            {l}
          </button>
        ))}
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '12px 14px', flexWrap: 'wrap', borderBottom: '1px solid var(--border)' }}>
          <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 180 }}>
            <Icon d={IC.search} size={14} color="var(--faint)" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)' }} />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search name, city, category, Place ID…"
              aria-label="Search businesses"
              className="input"
              style={{ padding: '8px 12px 8px 33px' }}
            />
          </div>
          {chips.map(([k, l, n]) => (
            <button
              key={k || 'all'}
              onClick={() => {
                setFStatus(k);
                setPage(1);
              }}
              className={`chip ${fStatus === k ? 'active' : ''}`}
            >
              <span>{l}</span>
              <span className="tnum" style={{ opacity: 0.75 }}>
                {n}
              </span>
            </button>
          ))}
          <select
            value={fCity}
            onChange={(e) => {
              setFCity(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by city"
            className="select"
          >
            <option value="">All cities</option>
            {(stats?.facets.cities ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={fCat}
            onChange={(e) => {
              setFCat(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by category"
            className="select"
          >
            <option value="">All categories</option>
            {(stats?.facets.categories ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {hasFilters ? (
            <button onClick={clearFilters} className="link-btn" style={{ fontSize: 12, padding: '6px 8px' }}>
              Clear
            </button>
          ) : null}
          <div style={{ position: 'relative' }}>
            <button onClick={() => setColsOpen((v) => !v)} aria-label="Column visibility" className="btn btn-outline btn-sm" style={{ padding: '7px 11px' }}>
              <Icon d={IC.columns} size={13} />
              <span>Columns</span>
            </button>
            {colsOpen ? (
              <div className="menu" style={{ top: 38, width: 190, borderRadius: 12, padding: 6 }}>
                {COL_DEFS.map(([k, l]) => (
                  <button key={k} onClick={() => setCols((x) => ({ ...x, [k]: !x[k] }))} className="menu-item" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <span style={{ width: 15, height: 15, borderRadius: 4, border: `1.5px solid ${cols[k] ? 'var(--accent)' : 'var(--border2)'}`, background: cols[k] ? 'var(--accent)' : 'var(--inputBg)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4" style={{ opacity: cols[k] ? 1 : 0 }}><path d="M20 6 9 17l-5-5" /></svg>
                    </span>
                    <span>{l}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {selIds.length > 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 14px', background: 'var(--accentSoft)', borderBottom: '1px solid var(--accentBorder)', flexWrap: 'wrap', animation: 'slideUp .18s ease' }}>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--accentInk)' }}>{selIds.length} selected</span>
            <button onClick={() => void bulk('check')} disabled={bulkBusy} className="btn btn-sm" style={{ color: 'var(--accentInk)', borderColor: 'var(--accentBorder)', background: 'var(--surface)' }}>
              {bulkBusy ? <Icon d={IC.spinner} size={11} stroke={3} spin /> : null}
              Check selected
            </button>
            <button onClick={() => void bulk('export')} className="btn btn-sm" style={{ color: 'var(--accentInk)', borderColor: 'var(--accentBorder)', background: 'var(--surface)' }}>
              Export
            </button>
            <button onClick={() => void bulk('del')} className="btn btn-danger btn-sm">
              Delete
            </button>
            <div style={{ flex: 1 }} />
            <button onClick={() => setSel({})} aria-label="Clear selection" style={{ color: 'var(--accentInk)' }}>
              <Icon d={IC.x} size={14} stroke={2.4} />
            </button>
          </div>
        ) : null}

        {items === null ? (
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} h={38} />
            ))}
          </div>
        ) : firstRun ? (
          <EmptyState
            icon={IC.upload}
            title="Add your businesses to get started"
            sub="Import a CSV of Google Business Profiles (name + Place ID) or add them one by one. GMB Guard checks each one immediately and then every day."
            action={
              <div style={{ display: 'flex', gap: 9 }}>
                <Link href="/import" className="btn btn-primary" style={{ textDecoration: 'none', fontSize: 13, padding: '9px 15px' }}>
                  Import businesses
                </Link>
                <button onClick={() => setAddOpen(true)} className="btn btn-outline" style={{ fontSize: 13, padding: '9px 15px' }}>
                  Add one
                </button>
              </div>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={IC.search}
            title="No listings match"
            sub="Try a different search or clear the filters."
            action={
              <button onClick={clearFilters} className="btn btn-soft btn-sm">
                Clear filters
              </button>
            }
          />
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <div style={{ minWidth: sm ? 0 : tableMinW }}>
                {!sm ? (
                  <div>
                    <div role="row" className="th" style={{ display: 'grid', gridTemplateColumns: tableCols, alignItems: 'center', gap: 12, padding: '9px 16px', position: 'sticky', top: 0, background: 'var(--well)', borderBottom: '1px solid var(--border)', zIndex: 10 }}>
                      <Checkbox
                        checked={allSel}
                        label="Select all on page"
                        onChange={() => {
                          const next = { ...sel };
                          items.forEach((b) => (next[b.id] = !allSel));
                          setSel(next);
                        }}
                      />
                      {sortBtn('name', 'Business')}
                      {cols.city ? sortBtn('city', 'City') : null}
                      {cols.cat ? sortBtn('category', 'Category') : null}
                      {cols.url ? <span>URL</span> : null}
                      {sortBtn('currentStatus', 'Status')}
                      {cols.checked ? sortBtn('lastCheckedAt', 'Checked') : null}
                      {cols.changed ? sortBtn('updatedAt', 'Updated') : null}
                      <span />
                    </div>
                    {items.map((b) => {
                      const isSel = !!sel[b.id];
                      const busy = !!rowBusy[b.id];
                      return (
                        <div
                          key={b.id}
                          role="row"
                          onClick={() => app.openDrawer(b.id)}
                          className="row-hover"
                          style={{ display: 'grid', gridTemplateColumns: tableCols, alignItems: 'center', gap: 12, padding: '9px 16px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: isSel ? 'var(--accentSoft)' : 'transparent', position: 'relative' }}
                        >
                          <Checkbox
                            checked={isSel}
                            label="Select row"
                            onChange={(e) => {
                              e.stopPropagation();
                              setSel((x) => ({ ...x, [b.id]: !x[b.id] }));
                            }}
                          />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                              <span className="ell" style={{ fontSize: 13, fontWeight: 700 }}>
                                {b.name}
                              </span>
                              {b.tag ? <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--accentInk)', background: 'var(--accentSoft)', borderRadius: 5, padding: '1px 6px', whiteSpace: 'nowrap', flex: '0 0 auto' }}>{b.tag}</span> : null}
                              {!b.monitoringEnabled ? <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--faint)', background: 'var(--surface2)', borderRadius: 5, padding: '1px 6px', whiteSpace: 'nowrap' }}>Paused</span> : null}
                            </div>
                            <div className="ell mono" style={{ fontSize: 11, color: 'var(--faint)' }} title={b.placeId}>
                              {locationLine(b) || b.placeId}
                            </div>
                          </div>
                          {cols.city ? <span className="ell" style={{ fontSize: 12.5, color: 'var(--muted)' }}>{b.city ?? '—'}</span> : null}
                          {cols.cat ? <span className="ell" style={{ fontSize: 12.5, color: 'var(--muted)' }}>{b.category ?? '—'}</span> : null}
                          {cols.url ? (
                            <a href={mapsUrl(b.placeId, b.cid)} target="_blank" rel="noreferrer" aria-label="Open Google profile" onClick={(e) => e.stopPropagation()} style={{ color: 'var(--faint)', display: 'inline-flex' }}>
                              <Icon d={IC.ext} size={14} />
                            </a>
                          ) : null}
                          <div>
                            <StatusPill status={uiStatus(b)} busy={busy} pop={!!just[b.id]} stale={!!b.lastError} staleTitle={b.lastError ?? undefined} />
                          </div>
                          {cols.checked ? (
                            <div className="tnum" style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--muted)' }} title={b.lastError ?? undefined}>
                              <span>{relTime(b.lastCheckedAt)}</span>
                              {b.lastError ? <Icon d={IC.alert} size={11} color="var(--warn)" /> : null}
                              <button onClick={(e) => void rowCheck(b, e)} aria-label="Check this listing now" title="Check now" className="ghost-btn" style={{ color: 'var(--faint)', animation: busy ? 'spin 1s linear infinite' : undefined }}>
                                <Icon d={IC.refresh} size={12} stroke={2.2} />
                              </button>
                            </div>
                          ) : null}
                          {cols.changed ? <span className="tnum" style={{ fontSize: 12, color: 'var(--muted)' }}>{fdate(b.updatedAt)}</span> : null}
                          <div style={{ position: 'relative' }}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setMenuRow((m) => (m === b.id ? null : b.id));
                              }}
                              aria-label="Row actions"
                              className="ghost-btn"
                              style={{ width: 26, height: 26 }}
                            >
                              <Icon d={IC.dots} size={14} stroke={3} />
                            </button>
                            {menuRow === b.id ? (
                              <div className="menu" style={{ top: 30, width: 168 }} onClick={(e) => e.stopPropagation()}>
                                <button onClick={() => { setMenuRow(null); void rowCheck(b); }} className="menu-item">Check now</button>
                                <button onClick={() => { setMenuRow(null); app.openDrawer(b.id); }} className="menu-item">View history</button>
                                <button onClick={() => { setMenuRow(null); app.openDrawer(b.id, 'notes'); }} className="menu-item">Edit notes</button>
                                <button
                                  onClick={async () => {
                                    setMenuRow(null);
                                    try {
                                      const r = await api.listings.update(b.id, { monitoringEnabled: !b.monitoringEnabled });
                                      setItems((list) => (list ? list.map((x) => (x.id === b.id ? r.listing : x)) : list));
                                      app.toast(r.listing.monitoringEnabled ? 'Monitoring resumed' : 'Monitoring paused', `"${b.name}"`);
                                    } catch (err) {
                                      app.toast('Update failed', errorMessage(err), { tone: 'bad' });
                                    }
                                  }}
                                  className="menu-item"
                                >
                                  {b.monitoringEnabled ? 'Pause monitoring' : 'Resume monitoring'}
                                </button>
                                <button onClick={() => delBiz(b)} className="menu-item danger">Delete</button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {items.map((b) => (
                      <button key={b.id} onClick={() => app.openDrawer(b.id)} className="row-hover" style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '13px 16px', borderBottom: '1px solid var(--border)', textAlign: 'left', width: '100%', background: sel[b.id] ? 'var(--accentSoft)' : 'transparent' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="ell" style={{ fontSize: 13.5, fontWeight: 700 }}>{b.name}</div>
                            <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>{[b.city, b.category].filter(Boolean).join(' · ') || b.placeId}</div>
                          </div>
                          <StatusPill status={uiStatus(b)} busy={!!rowBusy[b.id]} small stale={!!b.lastError} staleTitle={b.lastError ?? undefined} />
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>Checked {relTime(b.lastCheckedAt)} · updated {fdate(b.updatedAt)}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <Pager page={page} totalPages={pag?.totalPages ?? 1} onPage={setPage} info={`${start}–${end} of ${total}`} pageSize={ps} onPageSize={(n) => { setPs(n); setPage(1); }} />
          </>
        )}
      </div>

      {(menuRow !== null || colsOpen) && (
        <div
          onClick={() => {
            setMenuRow(null);
            setColsOpen(false);
          }}
          style={{ position: 'fixed', inset: 0, zIndex: 20 }}
        />
      )}

      {addOpen ? (
        <ListingModal
          mode="add"
          onClose={() => setAddOpen(false)}
          onSaved={() => {
            setAddOpen(false);
            setPage(1);
            app.bumpRefresh();
          }}
        />
      ) : null}
      {exportOpen ? <ExportModal onClose={() => setExportOpen(false)} filters={params} filteredCount={total} totalCount={N} selectedIds={selIds} /> : null}
    </div>
  );
}
