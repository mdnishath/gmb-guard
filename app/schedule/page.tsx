'use client';

import { useEffect, useMemo, useState } from 'react';
import { useApp, errorMessage } from '@/components/app-context';
import { Card, IC, Icon, Skeleton, Toggle } from '@/components/ui';
import { api, type CheckRun, type SettingsResponse } from '@/lib/client/api';
import { countdown, cronToLabel, fdt, humanMs, nextCronRun, relTime } from '@/lib/client/format';

export default function SchedulePage() {
  const app = useApp();
  const [s, setS] = useState<SettingsResponse | null>(null);
  const [runs, setRuns] = useState<CheckRun[] | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    api.settings.get().then(setS).catch((err) => app.toast('Could not load settings', errorMessage(err), { tone: 'bad' }));
    api.checkRuns(10).then((r) => setRuns(r.items)).catch(() => setRuns([]));
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, [app, app.refreshKey]);

  const cron = s?.cron.schedule ?? '0 3 * * *';
  const paused = s?.settings.monitoringPaused ?? false;
  const upcoming = useMemo(() => {
    const out: Date[] = [];
    let from = new Date();
    for (let i = 0; i < 3; i++) {
      const n = nextCronRun(cron, from);
      if (!n) break;
      out.push(n);
      from = new Date(n.getTime() + 60_000);
    }
    return out;
  }, [cron, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const next = countdown(upcoming[0] ?? null);
  const last = runs?.[0] ?? null;

  const togglePause = async (v: boolean) => {
    try {
      setS(await api.settings.patch({ monitoringPaused: v }));
      app.toast(v ? 'Automatic checks paused' : 'Automatic checks resumed', v ? 'The scheduled run will skip until you resume. Manual checks still work.' : `Next run ${next.short}.`, { tone: v ? 'warn' : 'ok' });
    } catch (err) {
      app.toast('Could not save', errorMessage(err), { tone: 'bad' });
    }
  };

  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <h1 className="h1">Schedule</h1>
      <p className="sub">When GMB Guard automatically checks every listing.</p>
      {!s ? (
        <div style={{ display: 'grid', gap: 14, marginTop: 18 }}><Skeleton h={180} style={{ borderRadius: 14 }} /><Skeleton h={160} style={{ borderRadius: 14 }} /></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 18 }}>
          <Card style={{ padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div className="card-title">Automatic checks</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: paused ? 'var(--warn)' : 'var(--ok)', marginTop: 2 }}>{paused ? 'Paused — scheduled runs are skipped' : `Active · ${cronToLabel(cron)}`}</div>
              </div>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{paused ? 'Paused' : 'Running'}</span>
              <Toggle on={!paused} onChange={(v) => void togglePause(!v)} label="Automatic checks" size="lg" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12, marginTop: 16 }}>
              <div><label className="label">Cron schedule (UTC)</label><div className="mono well-box" style={{ marginTop: 6, fontSize: 13, fontWeight: 600 }}>{cron}</div></div>
              <div><label className="label">Concurrency</label><div className="well-box" style={{ marginTop: 6, fontSize: 13, fontWeight: 600 }}>{s.tuning.concurrency} parallel requests · {s.tuning.timeoutMs / 1000}s timeout</div></div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 12, lineHeight: 1.6 }}>
              The schedule is defined by the server cron (crontab on the VPS or vercel.json). Change <span className="mono">CRON_SCHEDULE</span> in .env.local to keep this page in sync, and edit the crontab to change the real run time.
              {!s.cron.configured ? <span style={{ color: 'var(--warn)', fontWeight: 700 }}> CRON_SECRET is not set, so the scheduled endpoint is locked.</span> : null}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--faint)' }}>Next check <b style={{ color: 'var(--text)' }}>{paused ? 'paused' : next.short}</b></span>
              <div style={{ flex: 1 }} />
              <button onClick={() => void app.startCheckAll()} disabled={app.checkAll.running} className="btn btn-primary">
                <Icon d={IC.zap} size={13} stroke={2.2} />
                Run now
              </button>
            </div>
          </Card>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 14 }}>
            <Card style={{ padding: '18px 20px' }}>
              <div className="card-title">Last run</div>
              <div className="card-sub">{last ? `${fdt(last.finishedAt)} · ${last.trigger === 'CRON' ? 'scheduled' : 'manual'} · ${humanMs(last.durationMs)}` : 'No full run yet'}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9, marginTop: 13 }}>
                {[
                  ['Checked', last?.checked ?? 0, 'var(--ok)', 'var(--okBg)', 'var(--okBd)'],
                  ['Changed', last?.changed ?? 0, 'var(--bad)', 'var(--badBg)', 'var(--badBd)'],
                  ['Errors', last?.errors ?? 0, 'var(--warn)', 'var(--warnBg)', 'var(--warnBd)'],
                  ['Skipped', last?.skipped ?? 0, 'var(--na)', 'var(--naBg)', 'var(--naBd)'],
                ].map(([l, n, c, bg, bd]) => (
                  <div key={String(l)} className="stat-box" style={{ borderColor: String(bd), background: String(bg) }}>
                    <div className="tnum" style={{ fontSize: 19, fontWeight: 800, color: String(c) }}>{n}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: String(c) }}>{l}</div>
                  </div>
                ))}
              </div>
            </Card>
            <Card style={{ padding: '18px 20px' }}>
              <div className="card-title">Upcoming runs</div>
              <div style={{ display: 'flex', flexDirection: 'column', marginTop: 8 }}>
                {upcoming.map((u, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid var(--border)' }}>
                    <Icon d={IC.clock} size={14} color="var(--faint)" />
                    <span className="tnum" style={{ flex: 1, fontSize: 12.5, fontWeight: 600, textDecoration: paused ? 'line-through' : undefined, color: paused ? 'var(--faint)' : undefined }}>{fdt(u.toISOString())}</span>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>{u.toISOString().slice(11, 16)} UTC</span>
                  </div>
                ))}
                {upcoming.length === 0 ? <div style={{ fontSize: 12.5, color: 'var(--muted)', paddingTop: 8 }}>Could not parse the cron expression.</div> : null}
              </div>
            </Card>
          </div>
          <Card style={{ padding: '18px 20px' }}>
            <div className="card-title">Run history</div>
            <div style={{ overflowX: 'auto', marginTop: 8 }}>
              <div style={{ minWidth: 560 }}>
                <div className="th" style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr .8fr .8fr .8fr .8fr 1fr', gap: 10, padding: '8px 4px', borderBottom: '1px solid var(--border)', fontSize: 10.5 }}>
                  <span>Started</span><span>Trigger</span><span>Checked</span><span>Changed</span><span>Errors</span><span>Skipped</span><span>Duration</span>
                </div>
                {runs === null ? <Skeleton h={34} style={{ marginTop: 8 }} /> : runs.length === 0 ? <div style={{ padding: '14px 4px', fontSize: 12.5, color: 'var(--muted)' }}>No runs recorded yet.</div> : runs.map((r) => (
                  <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr .8fr .8fr .8fr .8fr 1fr', gap: 10, padding: '9px 4px', borderBottom: '1px solid var(--border)', fontSize: 12.5, alignItems: 'center' }}>
                    <span className="tnum" title={fdt(r.startedAt)}>{relTime(r.startedAt)}</span>
                    <span style={{ color: 'var(--muted)' }}>{r.trigger === 'CRON' ? 'Scheduled' : 'Manual'}</span>
                    <span className="tnum">{r.checked}/{r.total}</span>
                    <span className="tnum" style={{ color: r.changed ? 'var(--bad)' : undefined, fontWeight: r.changed ? 800 : 400 }}>{r.changed}</span>
                    <span className="tnum" style={{ color: r.errors ? 'var(--warn)' : undefined }}>{r.errors}</span>
                    <span className="tnum">{r.skipped}</span>
                    <span className="tnum" style={{ color: 'var(--muted)' }}>{humanMs(r.durationMs)}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
