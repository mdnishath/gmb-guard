'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type AlertLog, type AuditLog, type Credentials, type Listing } from '@/lib/client/api';
import { fdt, locationLine, mapsUrl, relTime, statusMeta, uiStatus } from '@/lib/client/format';
import { useApp, errorMessage } from './app-context';
import { IC, Icon, StatusPill } from './ui';
import { ListingModal } from './listing-modal';

export function ListingDrawer() {
  const app = useApp();
  const id = app.drawerId!;
  const [listing, setListing] = useState<Listing | null>(null);
  const [history, setHistory] = useState<AuditLog[]>([]);
  const [alerts, setAlerts] = useState<AlertLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pop, setPop] = useState(false);
  const [edit, setEdit] = useState(false);
  const [note, setNote] = useState('');
  const [noteState, setNoteState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tab = app.drawerTab;

  const load = useCallback(async () => {
    try {
      const r = await api.listings.get(id);
      setListing(r.listing);
      setHistory(r.history);
      setAlerts(r.alerts);
      setNote(r.listing.notes ?? '');
    } catch (err) {
      app.toast('Could not load listing', errorMessage(err), { tone: 'bad' });
      app.closeDrawer();
    } finally {
      setLoading(false);
    }
  }, [id, app]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load, app.refreshKey]);

  const checkNow = async () => {
    if (!listing || busy) return;
    setBusy(true);
    try {
      const r = await api.listings.checkOne(listing.id);
      setListing(r.listing);
      setPop(true);
      setTimeout(() => setPop(false), 1500);
      const why = r.result?.detail ? ` ${r.result.detail}` : '';
      if (r.result?.error) app.toast('Check failed', r.result.error, { tone: 'warn' });
      else if (r.result?.changed) {
        app.toast('Status changed', `"${listing.name}" is now ${statusMeta(r.listing.currentStatus).l}.${why}`, { tone: r.listing.currentStatus === 'ACTIVE' ? 'ok' : 'bad' });
        void load();
      } else app.toast('Check complete', `"${listing.name}" is ${statusMeta(r.listing.currentStatus).l}. No change.${why}`);
      app.bumpRefresh();
    } catch (err) {
      app.toast('Check failed', errorMessage(err), { tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };

  const del = () => {
    if (!listing) return;
    app.askConfirm({
      title: `Delete "${listing.name}"?`,
      msg: 'This removes the listing and its check history from GMB Guard. The Google Business Profile itself is not affected.',
      label: 'Delete listing',
      onYes: async () => {
        try {
          await api.listings.remove(listing.id);
          app.toast('Listing deleted', `"${listing.name}" was removed.`, { tone: 'na' });
          app.closeDrawer();
          app.bumpRefresh();
        } catch (err) {
          app.toast('Delete failed', errorMessage(err), { tone: 'bad' });
        }
      },
    });
  };

  const onNote = (v: string) => {
    setNote(v);
    setNoteState('idle');
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(async () => {
      if (!listing) return;
      setNoteState('saving');
      try {
        await api.listings.update(listing.id, { notes: v });
        setNoteState('saved');
      } catch (err) {
        setNoteState('idle');
        app.toast('Could not save notes', errorMessage(err), { tone: 'bad' });
      }
    }, 700);
  };

  const setTab = (t: 'history' | 'alerts' | 'notes' | 'account') => app.openDrawer(id, t);
  const st = listing ? uiStatus(listing) : 'pend';

  // --- account credentials (loaded only on the Account tab) -------------------
  const [creds, setCreds] = useState<Credentials | null>(null);
  const [credsLoading, setCredsLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [left, setLeft] = useState(0);

  const loadCreds = useCallback(async () => {
    setCredsLoading(true);
    try {
      const c = await api.listings.credentials(id);
      setCreds(c);
      setLeft(c.totp?.expiresIn ?? 0);
    } catch (err) {
      app.toast('Could not load account', errorMessage(err), { tone: 'bad' });
    } finally {
      setCredsLoading(false);
    }
  }, [id, app]);

  useEffect(() => {
    if (tab === 'account' && listing) void loadCreds();
    if (tab !== 'account') setShowPw(false);
  }, [tab, listing, loadCreds]);

  useEffect(() => {
    if (tab !== 'account' || !creds?.totp) return;
    const t = setInterval(() => {
      setLeft((s) => {
        if (s <= 1) {
          void loadCreds();
          return creds.totp?.step ?? 30;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [tab, creds, loadCreds]);

  const copy = async (label: string, value: string | null) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      app.toast(`${label} copied`, undefined, { tone: 'ok' });
    } catch {
      app.toast('Copy failed', 'Your browser blocked clipboard access.', { tone: 'warn' });
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60 }}>
      <div onClick={app.closeDrawer} style={{ position: 'absolute', inset: 0, background: 'var(--scrim)', animation: 'fadeIn .2s' }} />
      <aside role="dialog" aria-label="Listing details" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(460px, 100vw)', background: 'var(--surface)', borderLeft: '1px solid var(--border)', boxShadow: 'var(--shadowLg)', display: 'flex', flexDirection: 'column', animation: 'drawerIn .28s cubic-bezier(.2,.8,.25,1)' }}>
        {loading || !listing ? (
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="skel" style={{ height: 26, width: '70%' }} />
            <div className="skel" style={{ height: 14, width: '50%' }} />
            <div className="skel" style={{ height: 80, marginTop: 10 }} />
          </div>
        ) : (
          <>
            <div style={{ padding: '18px 20px 0' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: -0.3, lineHeight: 1.3 }}>{listing.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{locationLine(listing) || 'No address on file'}</div>
                </div>
                <button onClick={app.closeDrawer} aria-label="Close" className="ghost-btn" style={{ width: 30, height: 30, borderRadius: 8, flex: '0 0 auto' }}>
                  <Icon d={IC.x} size={15} stroke={2.4} />
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <StatusPill status={st} busy={busy} pop={pop} stale={!!listing.lastError} staleTitle={listing.lastError ?? undefined} />
                <span style={{ fontSize: 12, color: 'var(--faint)' }}>Checked {relTime(listing.lastCheckedAt)}</span>
                {listing.lastError ? (
                  <span title={listing.lastError} style={{ fontSize: 11.5, color: 'var(--warn)', fontWeight: 700 }}>
                    · last check errored
                  </span>
                ) : null}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9, marginTop: 14 }}>
                <div className="well-box">
                  <div className="th" style={{ fontSize: 10.5 }}>Category</div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 2 }}>{listing.category || '—'}</div>
                </div>
                <div className="well-box" style={{ minWidth: 0 }}>
                  <div className="th" style={{ fontSize: 10.5 }}>{listing.placeId.startsWith('cid:') ? 'Google CID' : 'Place ID'}</div>
                  <div className="mono ell" style={{ fontSize: 11.5, fontWeight: 600, marginTop: 2 }} title={listing.placeId.startsWith('cid:') ? 'Monitored by CID — the Place ID is filled in automatically on the first check' : listing.placeId}>
                    {listing.placeId.startsWith('cid:') ? listing.placeId.slice(4) : listing.placeId}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <button onClick={() => void checkNow()} disabled={busy} className="btn btn-soft btn-sm" style={{ padding: '7px 12px' }}>
                  <Icon d={IC.refresh} size={11} stroke={2.4} spin={busy} />
                  <span>Check now</span>
                </button>
                <a href={mapsUrl(listing.placeId, listing.cid)} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm" style={{ padding: '7px 12px', textDecoration: 'none' }}>
                  <Icon d={IC.ext} size={11} stroke={2.2} />
                  <span>Open profile</span>
                </a>
                <button onClick={() => setEdit(true)} className="btn btn-outline btn-sm" style={{ padding: '7px 12px' }}>
                  <Icon d={IC.edit} size={11} stroke={2.2} />
                  <span>Edit</span>
                </button>
                <div style={{ flex: 1 }} />
                <button onClick={del} aria-label="Delete listing" className="btn btn-danger" style={{ width: 31, height: 31, padding: 0, borderColor: 'var(--border2)' }}>
                  <Icon d={IC.trash} size={13} />
                </button>
              </div>
              <div style={{ display: 'flex', gap: 2, marginTop: 16, borderBottom: '1px solid var(--border)' }}>
                {(['history', 'alerts', 'account', 'notes'] as const).map((t) => (
                  <button key={t} onClick={() => setTab(t)} className={`tab ${tab === t ? 'active' : ''}`} style={{ fontSize: 12.5, padding: '8px 12px' }}>
                    {t === 'history' ? 'History' : t === 'alerts' ? 'Alert log' : t === 'account' ? 'Account' : 'Notes'}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 24px' }}>
              {tab === 'history' ? (
                history.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                    No status changes recorded yet. {listing.lastCheckedAt ? `Current status: ${statusMeta(listing.currentStatus).l}.` : 'This listing has not been checked yet.'}
                  </div>
                ) : (
                  history.map((ev, i) => {
                    const m = statusMeta(ev.newStatus);
                    return (
                      <div key={ev.id} style={{ display: 'flex', gap: 12 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: '0 0 auto' }}>
                          <span style={{ width: 11, height: 11, borderRadius: '50%', background: m.bg, border: `2.5px solid ${m.c}`, marginTop: 3 }} />
                          {i < history.length - 1 ? <span style={{ width: 2, flex: 1, background: 'var(--border)', margin: '4px 0' }} /> : null}
                        </div>
                        <div style={{ paddingBottom: 18, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: m.c }}>{ev.newStatus === 'ACTIVE' ? 'Back live' : m.l}</span>
                            <span style={{ fontSize: 11, color: 'var(--faint)' }}>from {statusMeta(ev.previousStatus).l}</span>
                          </div>
                          <div className="tnum" style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 1 }}>
                            {fdt(ev.checkedAt)}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )
              ) : null}
              {tab === 'alerts' ? (
                alerts.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>No alerts sent for this listing yet.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {alerts.map((a) => (
                      <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
                        <span className="tnum" style={{ fontSize: 12, color: 'var(--muted)', flex: 1 }}>
                          {fdt(a.createdAt)}
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: a.event === 'RECOVERED' ? 'var(--ok)' : 'var(--bad)' }}>{a.event}</span>
                        <span style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--faint)', background: 'var(--surface2)', borderRadius: 5, padding: '2px 7px', width: 74, textAlign: 'center' }}>{a.channel}</span>
                        <span style={{ fontSize: 12, fontWeight: 800, color: a.status === 'SENT' ? 'var(--ok)' : 'var(--bad)' }} title={a.error ?? undefined}>
                          {a.status === 'SENT' ? 'Sent' : 'Failed'}
                        </span>
                      </div>
                    ))}
                  </div>
                )
              ) : null}
              {tab === 'account' ? (
                credsLoading && !creds ? (
                  <div className="skel" style={{ height: 120 }} />
                ) : !creds || (!creds.accountEmail && !creds.accountPassword && !creds.totpSecret) ? (
                  <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                    No Google account saved for this listing.{' '}
                    <button onClick={() => setEdit(true)} className="link-btn" style={{ fontWeight: 700 }}>
                      Add email, password and 2FA secret
                    </button>
                    .
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div className="well-box">
                      <div className="th" style={{ fontSize: 10.5 }}>Google account email</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
                        <span className="ell" style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>{creds.accountEmail ?? '—'}</span>
                        {creds.accountEmail ? (
                          <button onClick={() => void copy('Email', creds.accountEmail)} aria-label="Copy email" className="icon-btn" style={{ width: 28, height: 28 }}>
                            <Icon d={IC.copy} size={13} />
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <div className="well-box">
                      <div className="th" style={{ fontSize: 10.5 }}>Password</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
                        <span className="ell mono" style={{ flex: 1, fontSize: 13, fontWeight: 700, letterSpacing: showPw ? 0 : 2 }}>
                          {creds.accountPassword ? (showPw ? creds.accountPassword : '••••••••••') : '—'}
                        </span>
                        {creds.accountPassword ? (
                          <>
                            <button onClick={() => setShowPw((v) => !v)} aria-label="Reveal password" className="icon-btn" style={{ width: 28, height: 28, color: showPw ? 'var(--accentInk)' : undefined }}>
                              <Icon d={IC.eye} size={13} />
                            </button>
                            <button onClick={() => void copy('Password', creds.accountPassword)} aria-label="Copy password" className="icon-btn" style={{ width: 28, height: 28 }}>
                              <Icon d={IC.copy} size={13} />
                            </button>
                          </>
                        ) : null}
                      </div>
                    </div>
                    <div className="well-box" style={{ borderColor: creds.totp ? 'var(--accentBorder)' : undefined }}>
                      <div className="th" style={{ fontSize: 10.5 }}>2-step verification code</div>
                      {creds.totp ? (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                            <span className="mono tnum" style={{ flex: 1, fontSize: 26, fontWeight: 800, letterSpacing: 4, color: 'var(--accentInk)' }}>
                              {creds.totp.code.slice(0, 3)} {creds.totp.code.slice(3)}
                            </span>
                            <span className="tnum" style={{ fontSize: 11.5, fontWeight: 700, color: left <= 5 ? 'var(--bad)' : 'var(--muted)', width: 34, textAlign: 'right' }}>
                              {left}s
                            </span>
                            <button onClick={() => void copy('Code', creds.totp?.code ?? null)} aria-label="Copy code" className="icon-btn" style={{ width: 28, height: 28 }}>
                              <Icon d={IC.copy} size={13} />
                            </button>
                          </div>
                          <div className="progress" style={{ height: 4, marginTop: 8 }}>
                            <i style={{ width: `${(left / (creds.totp.step || 30)) * 100}%`, transition: 'width 1s linear' }} />
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 6 }}>Same code as Google Authenticator. Refreshes automatically.</div>
                        </>
                      ) : (
                        <div style={{ fontSize: 12.5, color: creds.totpError ? 'var(--bad)' : 'var(--muted)', marginTop: 3 }}>{creds.totpError ?? 'No 2FA secret saved.'}</div>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--faint)' }}>Stored encrypted. Only shown here, never in lists or exports.</div>
                  </div>
                )
              ) : null}
              {tab === 'notes' ? (
                <div>
                  <textarea value={note} onChange={(e) => onNote(e.target.value)} placeholder="Add internal notes about this listing — reinstatement requests, client context, verification steps…" aria-label="Listing notes" className="input" />
                  <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 7 }}>{noteState === 'saving' ? 'Saving…' : noteState === 'saved' ? 'Saved.' : 'Notes save automatically.'}</div>
                </div>
              ) : null}
            </div>
          </>
        )}
      </aside>
      {edit && listing ? (
        <ListingModal
          mode="edit"
          listing={listing}
          onClose={() => setEdit(false)}
          onSaved={(l) => {
            setListing(l);
            setEdit(false);
            app.bumpRefresh();
          }}
        />
      ) : null}
    </div>
  );
}
