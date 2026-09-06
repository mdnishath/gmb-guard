'use client';

import { useCallback, useEffect, useState } from 'react';
import { useApp, errorMessage } from '@/components/app-context';
import { Card, IC, Icon, Pager, Skeleton, Toggle } from '@/components/ui';
import { api, type AlertLog, type AppSettings, type Pagination, type SettingsResponse } from '@/lib/client/api';
import { fdt } from '@/lib/client/format';

const EVENT_META: Record<string, { l: string; c: string; bg: string; bd: string }> = {
  SUSPENDED: { l: 'Suspended', c: 'var(--bad)', bg: 'var(--badBg)', bd: 'var(--badBd)' },
  CLOSED: { l: 'Closed', c: 'var(--na)', bg: 'var(--naBg)', bd: 'var(--naBd)' },
  RECOVERED: { l: 'Back live', c: 'var(--ok)', bg: 'var(--okBg)', bd: 'var(--okBd)' },
  CHANGED: { l: 'Changed', c: 'var(--warn)', bg: 'var(--warnBg)', bd: 'var(--warnBd)' },
  RUN_SUMMARY: { l: 'Daily digest', c: 'var(--accentInk)', bg: 'var(--accentSoft)', bd: 'var(--accentBorder)' },
  TEST: { l: 'Test', c: 'var(--muted)', bg: 'var(--surface2)', bd: 'var(--border2)' },
};

export default function AlertsPage() {
  const app = useApp();
  const [tab, setTab] = useState<'prefs' | 'log'>('prefs');
  const [s, setS] = useState<SettingsResponse | null>(null);
  const [emailIn, setEmailIn] = useState('');
  const [testing, setTesting] = useState(false);
  const [log, setLog] = useState<AlertLog[] | null>(null);
  const [pag, setPag] = useState<Pagination | null>(null);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    api.settings.get().then(setS).catch((err) => app.toast('Could not load settings', errorMessage(err), { tone: 'bad' }));
  }, [app]);

  const loadLog = useCallback(() => {
    setLog(null);
    api
      .alertLogs({ page, pageSize: 25, event: filter || undefined })
      .then((r) => {
        setLog(r.items);
        setPag(r.pagination);
      })
      .catch((err) => app.toast('Could not load alert log', errorMessage(err), { tone: 'bad' }));
  }, [page, filter, app]);

  useEffect(() => {
    if (tab === 'log') loadLog();
  }, [tab, loadLog, app.refreshKey]);

  const patch = async (p: Partial<AppSettings>) => {
    try {
      setS(await api.settings.patch(p));
    } catch (err) {
      app.toast('Could not save', errorMessage(err), { tone: 'bad' });
    }
  };

  const addEmail = () => {
    const e = emailIn.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      app.toast('Invalid email', 'Enter a valid address like name@agency.com', { tone: 'warn' });
      return;
    }
    if (!s) return;
    if (s.channels.email.allRecipients.includes(e)) {
      setEmailIn('');
      return;
    }
    void patch({ extraEmailRecipients: [...s.settings.extraEmailRecipients, e] });
    setEmailIn('');
  };

  const test = async () => {
    setTesting(true);
    try {
      const r = await api.settings.testAlert();
      const sent = r.channels.filter((c) => c.status === 'sent').map((c) => c.channel);
      const failed = r.channels.filter((c) => c.status === 'failed');
      if (failed.length) app.toast('Test alert failed', failed.map((f) => `${f.channel}: ${f.error}`).join(' · '), { tone: 'bad' });
      else if (sent.length) app.toast('Test alert sent', `Delivered via ${sent.join(' and ')}.`);
      else app.toast('No channel configured', 'Add TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID or RESEND_API_KEY to .env.local and restart.', { tone: 'warn' });
      app.bumpRefresh();
    } catch (err) {
      app.toast('Test failed', errorMessage(err), { tone: 'bad' });
    } finally {
      setTesting(false);
    }
  };

  const prefRows = s
    ? [
        { k: 'alertOnSuspended' as const, l: 'Suspended / removed', sub: 'A profile disappears from Google (NOT_FOUND) or is suspended', dot: 'var(--bad)', on: s.settings.alertOnSuspended },
        { k: 'alertOnRecovered' as const, l: 'Back live', sub: 'A suspended or closed profile is operational again', dot: 'var(--ok)', on: s.settings.alertOnRecovered },
        { k: 'alertOnClosed' as const, l: 'Marked closed', sub: 'Google shows the business as permanently or temporarily closed', dot: 'var(--na)', on: s.settings.alertOnClosed },
        { k: 'digestEnabled' as const, l: 'Daily digest', sub: 'Summary after each scheduled run, only when something changed or errored', dot: 'var(--accentInk)', on: s.settings.digestEnabled },
      ]
    : [];

  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <h1 className="h1">Notifications</h1>
      <p className="sub">Who gets alerted, and how, when a listing changes status.</p>
      <div style={{ display: 'flex', gap: 2, marginTop: 18, borderBottom: '1px solid var(--border)' }}>
        <button onClick={() => setTab('prefs')} className={`tab ${tab === 'prefs' ? 'active' : ''}`}>Preferences</button>
        <button onClick={() => { setTab('log'); setPage(1); }} className={`tab ${tab === 'log' ? 'active' : ''}`}>Alert log</button>
      </div>

      {tab === 'prefs' ? (
        !s ? (
          <div style={{ display: 'grid', gap: 14, marginTop: 18 }}><Skeleton h={200} style={{ borderRadius: 14 }} /><Skeleton h={140} style={{ borderRadius: 14 }} /></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 18 }}>
            <Card style={{ padding: '18px 20px' }}>
              <div className="card-title">Channels</div>
              <div className="card-sub">Configured in .env.local (restart the app after changing it).</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 9, marginTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 13px', borderRadius: 11, border: `1px solid ${s.channels.telegram.configured ? 'var(--okBd)' : 'var(--border)'}`, background: s.channels.telegram.configured ? 'var(--okBg)' : 'var(--surface)' }}>
                  <Icon d={IC.send} size={15} color={s.channels.telegram.configured ? 'var(--ok)' : 'var(--faint)'} style={{ marginTop: 2 }} />
                  <div><div style={{ fontSize: 13, fontWeight: 700 }}>Telegram</div><div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 1 }}>{s.channels.telegram.configured ? `Bot connected · chat ${s.channels.telegram.chatId}` : 'Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID'}</div></div>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 13px', borderRadius: 11, border: `1px solid ${s.channels.email.configured ? 'var(--okBd)' : 'var(--border)'}`, background: s.channels.email.configured ? 'var(--okBg)' : 'var(--surface)' }}>
                  <Icon d={IC.mail} size={15} color={s.channels.email.configured ? 'var(--ok)' : 'var(--faint)'} style={{ marginTop: 2 }} />
                  <div><div style={{ fontSize: 13, fontWeight: 700 }}>Email (Resend)</div><div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 1 }}>{s.channels.email.configured ? `From ${s.channels.email.from}` : 'Set RESEND_API_KEY, ALERT_EMAIL_FROM and ALERT_EMAIL_TO'}</div></div>
                </div>
              </div>
              <button onClick={() => void test()} disabled={testing} className="btn btn-soft btn-sm" style={{ marginTop: 12 }}>
                {testing ? <Icon d={IC.spinner} size={11} stroke={3} spin /> : <Icon d={IC.send} size={11} />}
                Send test alert
              </button>
            </Card>
            <Card style={{ padding: '18px 20px' }}>
              <div className="card-title">Alerts by event</div>
              <div style={{ display: 'flex', flexDirection: 'column', marginTop: 8 }}>
                {prefRows.map((pr) => (
                  <div key={pr.k} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', borderTop: '1px solid var(--border)' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: pr.dot, flex: '0 0 auto' }} />
                    <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 700 }}>{pr.l}</div><div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>{pr.sub}</div></div>
                    <Toggle on={pr.on} onChange={(v) => void patch({ [pr.k]: v } as Partial<AppSettings>)} label={`Toggle ${pr.l} alerts`} />
                  </div>
                ))}
              </div>
            </Card>
            <Card style={{ padding: '18px 20px' }}>
              <div className="card-title">Email recipients</div>
              <div className="card-sub">Alerts go to every address below. Addresses from .env.local cannot be removed here.</div>
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 12 }}>
                {s.channels.email.envRecipients.map((e) => (
                  <span key={e} className="chip" style={{ padding: '5px 12px', background: 'var(--surface2)' }}>{e}</span>
                ))}
                {s.settings.extraEmailRecipients.map((e) => (
                  <span key={e} className="chip" style={{ padding: '5px 7px 5px 12px', background: 'var(--surface2)' }}>
                    <span>{e}</span>
                    <button onClick={() => void patch({ extraEmailRecipients: s.settings.extraEmailRecipients.filter((x) => x !== e) })} aria-label="Remove recipient" style={{ width: 16, height: 16, borderRadius: '50%', background: 'var(--border2)', color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon d={IC.x} size={9} stroke={3.4} />
                    </button>
                  </span>
                ))}
                {s.channels.email.allRecipients.length === 0 ? <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>No recipients yet.</span> : null}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 11, flexWrap: 'wrap' }}>
                <input value={emailIn} onChange={(e) => setEmailIn(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addEmail()} placeholder="name@agency.com" aria-label="Add recipient email" className="input" style={{ flex: 1, minWidth: 200, padding: '8px 12px' }} />
                <button onClick={addEmail} className="btn btn-soft">Add</button>
              </div>
            </Card>
          </div>
        )
      ) : (
        <div className="card" style={{ marginTop: 18, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>Every alert sent</span>
            <select value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }} aria-label="Filter by event" className="select" style={{ fontSize: 12, padding: '6px 26px 6px 10px', borderRadius: 8 }}>
              <option value="">All events</option>
              {Object.entries(EVENT_META).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}
            </select>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 660 }}>
              <div className="th" style={{ display: 'grid', gridTemplateColumns: '1.2fr 2fr 1.6fr 1fr .8fr', gap: 10, padding: '9px 16px', background: 'var(--well)', borderBottom: '1px solid var(--border)', fontSize: 10.5 }}>
                <span>Event</span><span>Listing</span><span>Channel · recipient</span><span>Sent</span><span>Status</span>
              </div>
              {log === null ? (
                <div style={{ padding: 14, display: 'grid', gap: 8 }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={34} />)}</div>
              ) : log.length === 0 ? (
                <div style={{ padding: '24px 16px', fontSize: 12.5, color: 'var(--muted)' }}>No alerts sent yet. Alerts appear here after a status change is detected, or when you send a test alert.</div>
              ) : (
                log.map((lg) => {
                  const m = EVENT_META[lg.event] ?? EVENT_META.CHANGED;
                  return (
                    <div key={lg.id} style={{ display: 'grid', gridTemplateColumns: '1.2fr 2fr 1.6fr 1fr .8fr', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                      <span><span className="pill" style={{ background: m.bg, borderColor: m.bd, color: m.c, fontSize: 11, padding: '2px 9px 2px 7px' }}><span className="pill-dot" style={{ width: 5, height: 5 }} /><span>{m.l}</span></span></span>
                      <span className="ell" style={{ fontSize: 12.5, fontWeight: 600 }}>
                        {lg.listingId ? <button onClick={() => app.openDrawer(lg.listingId!)} style={{ fontWeight: 600 }}>{lg.listing?.name ?? 'Deleted listing'}</button> : '—'}
                      </span>
                      <span className="ell" style={{ fontSize: 12, color: 'var(--muted)' }} title={lg.recipient ?? ''}>{lg.channel === 'TELEGRAM' ? 'Telegram' : 'Email'} · {lg.recipient ?? '—'}</span>
                      <span className="tnum" style={{ fontSize: 11.5, color: 'var(--faint)', whiteSpace: 'nowrap' }}>{fdt(lg.createdAt)}</span>
                      <span style={{ fontSize: 12, fontWeight: 800, color: lg.status === 'SENT' ? 'var(--ok)' : 'var(--bad)' }} title={lg.error ?? undefined}>{lg.status === 'SENT' ? 'Sent' : 'Failed'}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
          {pag && pag.totalPages > 1 ? <Pager page={page} totalPages={pag.totalPages} onPage={setPage} info={`${pag.total} alerts`} /> : null}
        </div>
      )}
    </div>
  );
}
