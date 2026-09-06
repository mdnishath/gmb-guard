'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useApp, errorMessage } from '@/components/app-context';
import { Card, CardHeader, Donut, IC, Icon, Skeleton, StatusPill, TrendChart } from '@/components/ui';
import { api, type AuditLog, type ReportsResponse, type SettingsResponse, type Stats } from '@/lib/client/api';
import { countdown, cronToLabel, ftime, initials, linePath, nextCronRun, pct, relTime, statusMeta } from '@/lib/client/format';

export default function DashboardPage() {
  const app = useApp();
  const [stats, setStats] = useState<Stats | null>(null);
  const [feed, setFeed] = useState<AuditLog[]>([]);
  const [reports, setReports] = useState<ReportsResponse | null>(null);
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([api.listings.stats(), api.auditLogs({ pageSize: 8 }), api.reports({ days: 30 }), api.settings.get()])
      .then(([s, f, r, st]) => {
        if (!alive) return;
        setStats(s);
        setFeed(f.items);
        setReports(r);
        setSettings(st);
        setError(null);
      })
      .catch((err) => alive && setError(errorMessage(err)));
    return () => {
      alive = false;
    };
  }, [app.refreshKey]);

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const cron = settings?.cron.schedule ?? '0 3 * * *';
  const next = useMemo(() => countdown(nextCronRun(cron)), [cron, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  if (error) {
    return (
      <div className="page" style={{ maxWidth: 1320 }}>
        <h1 className="h1">Overview</h1>
        <div className="card card-pad" style={{ marginTop: 18, borderColor: 'var(--badBd)' }}>
          <div style={{ fontWeight: 700, color: 'var(--bad)' }}>Could not load the dashboard</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>{error}</div>
        </div>
      </div>
    );
  }

  const N = stats?.total ?? 0;
  const dist = stats?.distribution ?? { ACTIVE: 0, SUSPENDED: 0, CLOSED: 0 };
  const pending = stats?.pending ?? 0;
  const live = Math.max(0, dist.ACTIVE - pending);
  const series = reports?.series ?? [];
  const t14 = series.slice(-14).map((s) => s.count);
  const sp = t14.length ? linePath(t14, 96, 30, 3) : null;
  const t30 = series.map((s) => s.count);
  const TL = linePath(t30, 640, 170, 10);
  const xl = series.length
    ? [0, 0.25, 0.5, 0.75, 1].map((f) => new Date(series[Math.round(f * (series.length - 1))].date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))
    : [];
  const lastRun = stats?.lastRun ?? null;

  const kpis = [
    { label: 'Total businesses', value: String(N), delta: pending ? `${pending} pending` : 'All checked', dC: pending ? 'var(--warn)' : 'var(--accentInk)', dBg: pending ? 'var(--warnBg)' : 'var(--accentSoft)', sub: `${stats?.monitoring.enabled ?? 0} monitored · ${stats?.monitoring.paused ?? 0} paused`, spark: null },
    { label: 'Live', value: String(live), delta: `+${stats?.activity.recoveriesLast24h ?? 0}`, dC: 'var(--ok)', dBg: 'var(--okBg)', sub: `${pct(live, N)} of portfolio`, spark: null },
    { label: 'Suspended', value: String(dist.SUSPENDED), delta: `${stats?.activity.suspensionsLast7d ?? 0} this week`, dC: dist.SUSPENDED ? 'var(--bad)' : 'var(--ok)', dBg: dist.SUSPENDED ? 'var(--badBg)' : 'var(--okBg)', sub: `${stats?.activity.recoveriesLast30d ?? 0} recovered in 30 days`, spark: sp ? { ...sp, c: 'var(--bad)', f: 'rgba(220,60,50,.10)' } : null },
    { label: 'Last full check', value: lastRun ? ftime(lastRun.finishedAt) : '—', delta: lastRun ? (lastRun.errors ? `${lastRun.errors} errors` : 'OK') : 'Never', dC: lastRun?.errors ? 'var(--warn)' : 'var(--na)', dBg: lastRun?.errors ? 'var(--warnBg)' : 'var(--naBg)', sub: lastRun ? `${relTime(lastRun.finishedAt)} · ${lastRun.checked} checked` : 'Run "Check all" to start', spark: null },
  ];

  const donut = [
    { color: 'var(--ok)', value: live },
    { color: 'var(--bad)', value: dist.SUSPENDED },
    { color: 'var(--warn)', value: pending },
    { color: 'var(--na)', value: dist.CLOSED },
  ];
  const legend = [
    { l: 'Live', c: 'var(--ok)', n: live },
    { l: 'Suspended', c: 'var(--bad)', n: dist.SUSPENDED },
    { l: 'Pending', c: 'var(--warn)', n: pending },
    { l: 'Closed', c: 'var(--na)', n: dist.CLOSED },
  ];

  const ck = app.checkAll;
  const twoCol = app.vw === 'lg';

  return (
    <div className="page" style={{ maxWidth: 1320 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h1 className="h1">Overview</h1>
          <p className="sub">
            {today} · {N} listings monitored · {cronToLabel(cron)}
          </p>
        </div>
        <button onClick={() => void app.startCheckAll()} disabled={ck.running} className="btn btn-primary btn-lg">
          <Icon d={IC.zap} size={14} stroke={2.2} />
          <span>Check All Now</span>
          <span style={{ fontSize: 10.5, fontWeight: 800, border: '1px solid rgba(255,255,255,.35)', borderRadius: 5, padding: '0 5px', opacity: 0.85 }}>C</span>
        </button>
      </div>

      {ck.running ? (
        <div className="card" style={{ borderColor: 'var(--accentBorder)', padding: '15px 18px', marginBottom: 16, boxShadow: 'var(--shadowMd)', animation: 'slideUp .3s ease' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 13, flexWrap: 'wrap' }}>
            <Icon d={IC.spinner} size={17} stroke={2.4} spin color="var(--accentInk)" />
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>
                Checking all listings… <span style={{ color: 'var(--muted)', fontWeight: 600 }}>{ck.total} queued</span>
              </div>
              <div className="progress indet" style={{ marginTop: 9 }}>
                <i />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {!stats ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 14 }}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} h={118} style={{ borderRadius: 14 }} />
          ))}
          <Skeleton h={280} style={{ gridColumn: '1/-1', borderRadius: 14 }} />
          <Skeleton h={220} style={{ gridColumn: '1/-1', borderRadius: 14 }} />
        </div>
      ) : (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 14 }}>
            {kpis.map((k) => (
              <div key={k.label} className="card" style={{ padding: '16px 16px 13px', minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>{k.label}</span>
                  <span style={{ fontSize: 11, fontWeight: 800, color: k.dC, background: k.dBg, padding: '2px 7px', borderRadius: 999, whiteSpace: 'nowrap' }}>{k.delta}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10, marginTop: 11 }}>
                  <span className="tnum" style={{ fontSize: 29, fontWeight: 800, letterSpacing: -0.8, lineHeight: 1 }}>
                    {k.value}
                  </span>
                  {k.spark ? (
                    <svg width="96" height="30" viewBox="0 0 96 30" preserveAspectRatio="none" style={{ flex: '0 0 auto', overflow: 'visible' }}>
                      <path d={k.spark.area} fill={k.spark.f} />
                      <path d={k.spark.d} fill="none" stroke={k.spark.c} strokeWidth="1.8" strokeLinejoin="round" />
                    </svg>
                  ) : null}
                </div>
                <div className="ell" style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 7 }}>
                  {k.sub}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: twoCol ? '1.65fr 1fr' : '1fr', gap: 14, marginTop: 14, alignItems: 'start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
              <Card style={{ minWidth: 0 }}>
                <CardHeader
                  title="Suspension trend"
                  sub="Suspended / closed events per day · last 30 days"
                  right={
                    <span className="pill" style={{ background: 'var(--badBg)', borderColor: 'var(--badBd)', color: 'var(--bad)', fontSize: 12, padding: '3px 10px' }}>
                      <span className="pill-dot" />
                      <span>{reports?.dropsToday ?? 0} today</span>
                    </span>
                  }
                />
                <TrendChart points={t30} labels={xl} cx={TL.lx} cy={TL.ly} line={TL.d} area={TL.area} />
              </Card>
              <Card style={{ minWidth: 0 }}>
                <CardHeader
                  title="Recent status changes"
                  sub="From scheduled checks and manual scans"
                  right={
                    <Link href="/businesses" className="link-btn">
                      View all
                    </Link>
                  }
                />
                <div style={{ marginTop: 6 }}>
                  {feed.length === 0 ? (
                    <div style={{ padding: '18px 0 6px', fontSize: 12.5, color: 'var(--muted)' }}>No status changes yet. Changes appear here after a check finds a listing suspended, closed or back live.</div>
                  ) : (
                    feed.map((f) => {
                      const to = statusMeta(f.newStatus);
                      const name = f.listing?.name ?? 'Deleted listing';
                      return (
                        <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 0', borderTop: '1px solid var(--border)' }}>
                          <span style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--surface2)', color: 'var(--muted)', fontSize: 11.5, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>{initials(name)}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="ell" style={{ fontSize: 13, fontWeight: 600 }}>
                              {name}
                            </div>
                            <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>
                              {f.listing?.city ? `${f.listing.city} · ` : ''}
                              {relTime(f.checkedAt)}
                            </div>
                          </div>
                          <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--faint)', whiteSpace: 'nowrap' }}>{statusMeta(f.previousStatus).l}</span>
                          <Icon d={IC.arrow} size={12} stroke={2.4} color="var(--faint)" />
                          <span className="pill" style={{ background: to.bg, borderColor: to.bd, color: to.c, fontSize: 11.5, padding: '2px 9px 2px 7px' }}>
                            <span className="pill-dot" style={{ width: 5, height: 5 }} />
                            <span>{f.newStatus === 'ACTIVE' ? 'Back live' : to.l}</span>
                          </span>
                          {f.listing ? (
                            <button onClick={() => app.openDrawer(f.listingId)} className="btn btn-outline btn-xs">
                              View
                            </button>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </div>
              </Card>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
              <Card>
                <div className="card-title">Status distribution</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 14, flexWrap: 'wrap' }}>
                  <Donut segments={donut} center={pct(live, N)} sub="Live" />
                  <div style={{ flex: 1, minWidth: 130, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {legend.map((lg) => (
                      <div key={lg.l} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 3, background: lg.c, flex: '0 0 auto' }} />
                        <span style={{ flex: 1, color: 'var(--muted)', fontWeight: 600 }}>{lg.l}</span>
                        <span className="tnum" style={{ fontWeight: 800 }}>
                          {lg.n}
                        </span>
                        <span className="tnum" style={{ color: 'var(--faint)', fontSize: 11.5, width: 44, textAlign: 'right' }}>
                          {pct(lg.n, N)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
              <Card>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon d={IC.clock} size={15} color="var(--muted)" />
                  <span className="card-title">Next auto-check</span>
                </div>
                <div className="tnum" style={{ fontSize: 27, fontWeight: 800, letterSpacing: -0.7, marginTop: 9 }}>
                  {settings?.settings.monitoringPaused ? 'Paused' : `in ${next.long}`}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{cronToLabel(cron)}</div>
                <div className="progress" style={{ height: 5, marginTop: 12 }}>
                  <i style={{ width: next.pct }} />
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                  <button onClick={() => void app.startCheckAll()} disabled={ck.running} className="btn btn-soft btn-sm">
                    Run now
                  </button>
                  <Link href="/schedule" className="btn btn-outline btn-sm" style={{ textDecoration: 'none' }}>
                    Schedule
                  </Link>
                </div>
              </Card>
              <Card>
                <div className="card-title">Alerts</div>
                {(['telegram', 'email'] as const).map((ch) => {
                  const on = settings?.channels[ch].configured ?? false;
                  return (
                    <div key={ch} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 11, fontSize: 12.5, color: 'var(--muted)' }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: on ? 'var(--ok)' : 'var(--border2)', flex: '0 0 auto' }} />
                      <span style={{ flex: 1 }}>{ch === 'telegram' ? 'Telegram alerts' : 'Email alerts'}</span>
                      <span style={{ fontWeight: 700, color: on ? 'var(--text)' : 'var(--faint)' }}>{on ? 'On' : 'Not configured'}</span>
                    </div>
                  );
                })}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12.5, color: 'var(--muted)' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accentInk)', flex: '0 0 auto' }} />
                  <span style={{ flex: 1 }}>{stats.activity.alertsLast24h} alerts sent in 24h</span>
                  <Link href="/alerts" className="link-btn" style={{ fontSize: 12 }}>
                    Manage
                  </Link>
                </div>
              </Card>
              {pending > 0 ? (
                <Card style={{ borderColor: 'var(--warnBd)' }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <StatusPill status="pend" />
                    <div style={{ fontSize: 12.5, color: 'var(--muted)', flex: 1 }}>{pending} listings have never been checked.</div>
                  </div>
                  <button onClick={() => void app.startCheckAll()} disabled={ck.running} className="btn btn-soft btn-sm" style={{ marginTop: 10 }}>
                    Check them now
                  </button>
                </Card>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
