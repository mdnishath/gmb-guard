'use client';

import { useEffect, useState } from 'react';
import { useApp, errorMessage } from '@/components/app-context';
import { Card, CardHeader, Donut, IC, Icon, Skeleton, StatusPill, TrendChart } from '@/components/ui';
import { api, type ReportsResponse } from '@/lib/client/api';
import { downloadText, fdate, linePath, pct, toCsv } from '@/lib/client/format';

type Range = '7d' | '30d' | '90d' | 'custom';

export default function ReportsPage() {
  const app = useApp();
  const [range, setRange] = useState<Range>('30d');
  const [from, setFrom] = useState(new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<ReportsResponse | null>(null);

  useEffect(() => {
    setData(null);
    const p = range === 'custom' ? { from, to: `${to}T23:59:59` } : { days: Number(range.replace('d', '')) };
    api
      .reports(p)
      .then(setData)
      .catch((err) => app.toast('Could not load reports', errorMessage(err), { tone: 'bad' }));
  }, [range, from, to, app.refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const pts = data?.series.map((s) => s.count) ?? [];
  const TL = linePath(pts, 640, 170, 10);
  const xl = data?.series.length ? [0, 0.25, 0.5, 0.75, 1].map((f) => new Date(data.series[Math.round(f * (data.series.length - 1))].date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })) : [];
  const N = data?.total ?? 0;
  const dist = data?.distribution ?? { ACTIVE: 0, SUSPENDED: 0, CLOSED: 0 };
  const twoCol = app.vw === 'lg';
  const maxCity = Math.max(1, ...(data?.cities.map((c) => c.count) ?? [1]));

  const exportCsv = () => {
    if (!data) return;
    downloadText(
      `gmb-suspension-report-${data.range.days}d.csv`,
      toCsv(
        data.events.map((e) => ({ name: e.name, city: e.city ?? '', status: e.status, suspendedAt: fdate(e.suspendedAt), duration: e.duration, recoveredAt: e.recoveredAt ? fdate(e.recoveredAt) : '', current: e.currentStatus })),
        [
          { key: 'name', label: 'Business' },
          { key: 'city', label: 'City' },
          { key: 'status', label: 'Event' },
          { key: 'suspendedAt', label: 'Suspended on' },
          { key: 'duration', label: 'Duration' },
          { key: 'recoveredAt', label: 'Recovered' },
          { key: 'current', label: 'Current status' },
        ],
      ),
    );
  };

  return (
    <div className="page" style={{ maxWidth: 1320 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h1 className="h1">Reports</h1>
          <p className="sub">Suspension history and portfolio health · last {data?.range.days ?? '…'} days</p>
        </div>
        <button onClick={exportCsv} disabled={!data} className="btn btn-outline">
          <Icon d={IC.download} size={13} stroke={2.2} />
          <span>Export CSV</span>
        </button>
        <button onClick={() => window.print()} className="btn btn-primary">
          <Icon d={IC.file} size={13} stroke={2.2} />
          <span>Print / PDF</span>
        </button>
      </div>

      <div className="seg" style={{ marginBottom: 14 }}>
        {(['7d', '30d', '90d', 'custom'] as Range[]).map((r) => (
          <button key={r} onClick={() => setRange(r)} className={`seg-btn ${range === r ? 'active' : ''}`} style={{ padding: '5px 12px' }}>
            {r === 'custom' ? 'Custom' : `Last ${r.replace('d', ' days')}`}
          </button>
        ))}
      </div>
      {range === 'custom' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '-6px 0 14px', flexWrap: 'wrap' }}>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" className="input" style={{ width: 'auto', padding: '7px 11px', fontSize: 12.5, fontWeight: 600 }} />
          <span style={{ color: 'var(--faint)', fontSize: 12, fontWeight: 700 }}>to</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" className="input" style={{ width: 'auto', padding: '7px 11px', fontSize: 12.5, fontWeight: 600 }} />
        </div>
      ) : null}

      {!data ? (
        <div style={{ display: 'grid', gap: 14 }}>
          <Skeleton h={260} style={{ borderRadius: 14 }} />
          <Skeleton h={220} style={{ borderRadius: 14 }} />
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: twoCol ? '1.65fr 1fr' : '1fr', gap: 14, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
            <Card style={{ minWidth: 0 }}>
              <CardHeader
                title="Suspensions over time"
                sub="Suspended / closed events per day"
                right={
                  <span className="pill" style={{ background: 'var(--badBg)', borderColor: 'var(--badBd)', color: 'var(--bad)', fontSize: 12, padding: '3px 10px' }}>
                    <span className="pill-dot" />
                    <span>{data.dropsToday} today</span>
                  </span>
                }
              />
              <TrendChart points={pts} labels={xl} cx={TL.lx} cy={TL.ly} line={TL.d} area={TL.area} />
            </Card>
            <Card style={{ minWidth: 0 }}>
              <div className="card-title">Suspension report</div>
              <div className="card-sub">Every suspension event with duration and recovery · {data.totalDrops} in range</div>
              <div style={{ overflowX: 'auto', marginTop: 12 }}>
                <div style={{ minWidth: 640 }}>
                  <div className="th" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1.2fr', gap: 10, padding: '8px 4px', borderBottom: '1px solid var(--border)', fontSize: 10.5 }}>
                    <span>Business</span><span>Suspended on</span><span>Duration</span><span>Recovered</span><span>Status now</span>
                  </div>
                  {data.events.length === 0 ? (
                    <div style={{ padding: '18px 4px', fontSize: 12.5, color: 'var(--muted)' }}>No suspensions in this period. 🎉</div>
                  ) : (
                    data.events.map((se) => (
                      <div key={se.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1.2fr', gap: 10, padding: '9px 4px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                        <div style={{ minWidth: 0 }}>
                          <button onClick={() => app.openDrawer(se.listingId)} className="ell" style={{ fontSize: 12.5, fontWeight: 700, display: 'block', textAlign: 'left', maxWidth: '100%' }}>{se.name}</button>
                          <div style={{ fontSize: 11, color: 'var(--faint)' }}>{se.city ?? '—'}</div>
                        </div>
                        <span className="tnum" style={{ fontSize: 12, color: 'var(--muted)' }}>{fdate(se.suspendedAt)}</span>
                        <span className="tnum" style={{ fontSize: 12, color: 'var(--muted)' }}>{se.duration}{se.recoveredAt ? '' : ' (ongoing)'}</span>
                        <span className="tnum" style={{ fontSize: 12, color: 'var(--muted)' }}>{se.recoveredAt ? fdate(se.recoveredAt) : '—'}</span>
                        <span><StatusPill status={se.currentStatus} small /></span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </Card>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
            <Card>
              <div className="card-title">Status distribution</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 14, flexWrap: 'wrap' }}>
                <Donut size={120} segments={[{ color: 'var(--ok)', value: dist.ACTIVE }, { color: 'var(--bad)', value: dist.SUSPENDED }, { color: 'var(--na)', value: dist.CLOSED }]} center={pct(dist.ACTIVE, N)} sub="Live" />
                <div style={{ flex: 1, minWidth: 120, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[['Live', 'var(--ok)', dist.ACTIVE], ['Suspended', 'var(--bad)', dist.SUSPENDED], ['Closed', 'var(--na)', dist.CLOSED]].map(([l, c, n]) => (
                    <div key={String(l)} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 3, background: String(c), flex: '0 0 auto' }} />
                      <span style={{ flex: 1, color: 'var(--muted)', fontWeight: 600 }}>{l}</span>
                      <span className="tnum" style={{ fontWeight: 800 }}>{n}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
            <Card>
              <div className="card-title">Most affected cities</div>
              <div className="card-sub">Currently suspended or closed</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 13 }}>
                {data.cities.length === 0 ? <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Nothing is down right now.</div> : null}
                {data.cities.map((cb) => (
                  <div key={cb.city} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="ell" style={{ fontSize: 12, fontWeight: 700, width: 84, flex: '0 0 auto' }}>{cb.city}</span>
                    <div style={{ flex: 1, height: 8, borderRadius: 999, background: 'var(--surface2)', overflow: 'hidden' }}><div style={{ height: '100%', borderRadius: 999, background: 'var(--warn)', width: `${(cb.count / maxCity) * 100}%` }} /></div>
                    <span className="tnum" style={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)', width: 20, textAlign: 'right' }}>{cb.count}</span>
                  </div>
                ))}
              </div>
            </Card>
            <Card>
              <div className="card-title">Lowest uptime</div>
              <div className="card-sub">{data.range.days}-day availability per listing</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 13 }}>
                {data.lowestUptime.length === 0 ? <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Every listing was live for the whole period.</div> : null}
                {data.lowestUptime.map((ur) => {
                  const c = ur.uptimePct < 80 ? 'var(--bad)' : ur.uptimePct < 95 ? 'var(--warn)' : 'var(--ok)';
                  return (
                    <div key={ur.listingId} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 130, flex: '0 0 auto', minWidth: 0 }}>
                        <button onClick={() => app.openDrawer(ur.listingId)} className="ell" style={{ fontSize: 12, fontWeight: 700, display: 'block', textAlign: 'left', maxWidth: '100%' }}>{ur.name}</button>
                        <div style={{ fontSize: 10.5, color: 'var(--faint)' }}>{ur.city ?? '—'} · {ur.incidents} incident{ur.incidents === 1 ? '' : 's'}</div>
                      </div>
                      <div style={{ flex: 1, height: 8, borderRadius: 999, background: 'var(--surface2)', overflow: 'hidden' }}><div style={{ height: '100%', borderRadius: 999, background: c, width: `${ur.uptimePct}%` }} /></div>
                      <span className="tnum" style={{ fontSize: 12, fontWeight: 800, color: c, width: 46, textAlign: 'right' }}>{ur.uptimePct.toFixed(1)}%</span>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
