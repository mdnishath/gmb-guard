'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp, errorMessage, type ThemePref } from '@/components/app-context';
import { EnrichModal } from '@/components/enrich-modal';
import { Card, IC, Icon, Skeleton, Toggle } from '@/components/ui';
import { api, type BackupInfo, type SettingsResponse, type User, type UserRole } from '@/lib/client/api';
import { fdt, relTime } from '@/lib/client/format';

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function SettingsPage() {
  const app = useApp();
  const [s, setS] = useState<SettingsResponse | null>(null);
  const [me, setMe] = useState<User | null>(null);

  useEffect(() => {
    api.settings.get().then(setS).catch((err) => app.toast('Could not load settings', errorMessage(err), { tone: 'bad' }));
    api.auth.me().then((r) => setMe(r.user)).catch(() => {});
  }, [app]);

  const isAdmin = me?.role === 'ADMIN';

  const tiles: Array<[ThemePref, string]> = [
    ['light', 'Light'],
    ['dark', 'Dark'],
    ['system', 'System'],
  ];

  const status = (ok: boolean, okText: string, badText: string) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: ok ? 'var(--ok)' : 'var(--warn)' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'currentColor' }} />
      {ok ? okText : badText}
    </span>
  );

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <h1 className="h1">Settings</h1>
      <p className="sub">Profile, team, backups, appearance and integrations.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 18 }}>
        <ProfileCard me={me} onSaved={setMe} />
        {isAdmin ? <TeamCard me={me} /> : null}

        <Card style={{ padding: '18px 20px' }}>
          <div className="card-title">Appearance</div>
          <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
            {tiles.map(([k, l]) => {
              const act = app.themePref === k;
              return (
                <button key={k} onClick={() => app.setThemePref(k)} style={{ border: `${act ? 2 : 1}px solid ${act ? 'var(--accent)' : 'var(--border2)'}`, borderRadius: 12, padding: 9, background: 'var(--surface)', width: 118 }}>
                  <span style={{ display: 'block', height: 52, borderRadius: 8, overflow: 'hidden', position: 'relative', border: '1px solid var(--border)', background: k === 'light' ? '#F7F8FA' : k === 'dark' ? '#0B0F14' : 'linear-gradient(105deg,#F7F8FA 49.5%,#0B0F14 50.5%)' }}>
                    <span style={{ position: 'absolute', left: 7, top: 7, width: '30%', height: 5, borderRadius: 3, background: k === 'dark' ? '#2E3A50' : '#D6DAE3' }} />
                    <span style={{ position: 'absolute', left: 7, top: 17, width: '60%', height: 5, borderRadius: 3, background: k === 'dark' ? '#212B3C' : '#E6E8EE', opacity: k === 'system' ? 0.5 : 1 }} />
                    <span style={{ position: 'absolute', right: 7, top: 27, width: '30%', height: 5, borderRadius: 3, background: k === 'light' ? '#E6E8EE' : '#2E3A50' }} />
                  </span>
                  <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: act ? 'var(--text)' : 'var(--muted)', marginTop: 7 }}>{l}</span>
                </button>
              );
            })}
          </div>
        </Card>

        {isAdmin ? <BackupCard /> : null}

        <Card style={{ padding: '18px 20px', borderColor: s?.google.disabled ? 'var(--badBd)' : undefined }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div className="card-title">Google API kill switch</div>
              <div className="card-sub">
                {s?.google.disabled ? 'ALL Google Places calls are blocked: no status checks, no lookups. Imports still work from Maps links (CID mode).' : 'Google Places API is active. Turn this on to guarantee zero API calls while testing.'}
                {s?.google.disabledByEnv ? ' Forced by GOOGLE_API_DISABLED in .env — remove it to re-enable.' : ''}
              </div>
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: s?.google.disabled ? 'var(--bad)' : 'var(--ok)' }}>{s?.google.disabled ? 'API OFF' : 'API ON'}</span>
            <Toggle
              on={!!s?.google.disabled}
              onChange={(v) => {
                if (!isAdmin || s?.google.disabledByEnv) return;
                void api.settings
                  .patch({ googleApiDisabled: v })
                  .then((r) => {
                    setS(r);
                    app.toast(v ? 'Google API disabled' : 'Google API enabled', v ? 'No request will reach Google until you turn it back on.' : 'Checks and lookups will use the API again.', { tone: v ? 'warn' : 'ok' });
                  })
                  .catch((err) => app.toast('Could not save', errorMessage(err), { tone: 'bad' }));
              }}
              label="Google API kill switch"
              size="lg"
            />
          </div>
        </Card>

        <Card style={{ padding: '18px 20px' }}>
          <div className="card-title">Status check method</div>
          <div className="card-sub">How Live / Suspended is decided on every check.</div>
          {!s ? (
            <Skeleton h={90} style={{ marginTop: 12 }} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 12 }}>
              {(
                [
                  ['api', 'Google Places API', 'Precise. 1 API call per listing per check.'],
                  ['free', 'Google Maps page (no API)', 'Free, but only works for listings imported from a Google Maps share link (maps.app.goo.gl/…). For those the link is followed and the business page confirms it. Listings identified only by a Place ID or CID cannot be verified this way — Google serves a script-only page to servers — so their status is left unchanged and marked unverified (dashed badge).'],
                  ['free-then-api', 'Maps page first, API as fallback', 'Recommended if you want to save calls: uses the free link check when it can confirm, and the API for everything it cannot.'],
                ] as const
              ).map(([k, l, sub]) => {
                const forced = s.google.disabled && k !== 'free';
                const on = (s.google.disabled ? 'free' : s.settings.checkMode) === k;
                return (
                  <button
                    key={k}
                    disabled={!isAdmin || forced}
                    onClick={() =>
                      void api.settings
                        .patch({ checkMode: k })
                        .then(setS)
                        .catch((err) => app.toast('Could not save', errorMessage(err), { tone: 'bad' }))
                    }
                    style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 12px', borderRadius: 11, background: on ? 'var(--accentSoft)' : 'var(--surface)', border: `1px solid ${on ? 'var(--accentBorder)' : 'var(--border)'}`, textAlign: 'left', opacity: forced ? 0.5 : 1 }}
                  >
                    <span style={{ width: 15, height: 15, borderRadius: '50%', border: `1.5px solid ${on ? 'var(--accent)' : 'var(--border2)'}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto', marginTop: 1 }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: on ? 'var(--accent)' : 'transparent' }} />
                    </span>
                    <span>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: 700 }}>{l}</span>
                      <span style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)', marginTop: 1 }}>{sub}</span>
                    </span>
                  </button>
                );
              })}
              {s.google.disabled ? <div style={{ fontSize: 11.5, color: 'var(--warn)', fontWeight: 600 }}>Google API is switched off, so checks always use the Maps page.</div> : null}
            </div>
          )}
        </Card>

        <Card style={{ padding: '18px 20px' }}>
          <div className="card-title">Google usage & limits</div>
          <div className="card-sub">Hard caps so a bug or a runaway import can never create a surprise bill.</div>
          {!s ? (
            <Skeleton h={80} style={{ marginTop: 12 }} />
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                    <span style={{ fontWeight: 700 }}>Google Places calls today (UTC)</span>
                    <span className="tnum" style={{ color: 'var(--muted)' }}>
                      {s.usage.count} / {s.usage.limit || '∞'}
                    </span>
                  </div>
                  <div className="progress" style={{ height: 7, marginTop: 7 }}>
                    <i style={{ width: `${s.usage.limit ? Math.min(100, (s.usage.count / s.usage.limit) * 100) : 0}%`, background: s.usage.limit && s.usage.count / s.usage.limit > 0.85 ? 'var(--bad)' : undefined }} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 5 }}>
                    {Object.entries(s.usage.byKind).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'No calls yet today'} · cap <span className="mono">GOOGLE_DAILY_CALL_LIMIT</span>
                  </div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginTop: 14 }}>
                {[
                  ['API requests', `${s.limits.apiPerMinute} / min / IP`],
                  ['Sign-in attempts', `${s.limits.loginPer10Min} / 10 min / IP`],
                  ['Google lookups (import)', `${s.limits.resolvePerMinute} batches / min`],
                  ['Check all listings', `${s.limits.checkAllPer5Min} / 5 min`],
                ].map(([l, v]) => (
                  <div key={l} className="well-box">
                    <div className="th" style={{ fontSize: 10.5 }}>{l}</div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 2 }}>{v}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>

        <Card style={{ padding: '18px 20px' }}>
          <div className="card-title">Integrations</div>
          <div className="card-sub">Set in .env.local (locally) or .env on the server. Restart the app after changes.</div>
          {!s ? (
            <Skeleton h={120} style={{ marginTop: 12 }} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', marginTop: 8 }}>
              {[
                { l: 'Google Places API', sub: 'GOOGLE_PLACES_API_KEY · used for every status check and lookup', ok: s.google.configured, okT: 'Configured', badT: 'Missing — checks will fail' },
                { l: 'Cron secret', sub: `CRON_SECRET · protects /api/cron/check-gmb · schedule ${s.cron.schedule} UTC`, ok: s.cron.configured, okT: 'Configured', badT: 'Missing — scheduled endpoint locked' },
                { l: 'Telegram', sub: 'TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID', ok: s.channels.telegram.configured, okT: `Chat ${s.channels.telegram.chatId}`, badT: 'Not configured' },
                { l: 'Email (Resend)', sub: 'RESEND_API_KEY + ALERT_EMAIL_FROM + ALERT_EMAIL_TO', ok: s.channels.email.configured, okT: `${s.channels.email.allRecipients.length} recipient${s.channels.email.allRecipients.length === 1 ? '' : 's'}`, badT: 'Not configured' },
                { l: 'Public URL', sub: 'APP_URL · deep links inside alerts', ok: !!s.appUrl, okT: s.appUrl ?? '', badT: 'Not set' },
              ].map((r) => (
                <div key={r.l} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{r.l}</div>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--faint)', marginTop: 1 }}>{r.sub}</div>
                  </div>
                  {status(r.ok, r.okT, r.badT)}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card style={{ padding: '18px 20px' }}>
          <div className="card-title">Monitoring</div>
          {!s ? (
            <Skeleton h={60} style={{ marginTop: 12 }} />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10, marginTop: 12 }}>
              {[
                ['Concurrency', `${s.tuning.concurrency} parallel`, 'GMB_CHECK_CONCURRENCY'],
                ['Batch delay', `${s.tuning.batchDelayMs} ms`, 'GMB_BATCH_DELAY_MS'],
                ['Google timeout', `${s.tuning.timeoutMs / 1000}s`, 'GOOGLE_PLACES_TIMEOUT_MS'],
                ['Database', 'SQLite · data/gmb.sqlite', 'DATABASE_PATH'],
              ].map(([l, v, k]) => (
                <div key={l} className="well-box">
                  <div className="th" style={{ fontSize: 10.5 }}>{l}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{v}</div>
                  <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 2 }}>{k}</div>
                </div>
              ))}
            </div>
          )}
          {isAdmin ? (
            <div style={{ display: 'flex', gap: 9, marginTop: 12, flexWrap: 'wrap' }}>
            <EnrichButton />
            <ClearHistoryButton />
            <button
              onClick={() =>
                void api.listings
                  .backfill()
                  .then((r) => {
                    app.toast('Cities & categories filled in', `${r.updated} listings updated.`);
                    app.bumpRefresh();
                  })
                  .catch((err) => app.toast('Backfill failed', errorMessage(err), { tone: 'bad' }))
              }
              className="btn btn-outline btn-sm"
            >
              Fill missing cities & categories
            </button>
            </div>
          ) : null}
          <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 12, lineHeight: 1.6 }}>
            How statuses are decided: Google <span className="mono">OK + OPERATIONAL</span> → Live · <span className="mono">NOT_FOUND / INVALID_REQUEST</span> → Suspended · <span className="mono">CLOSED_PERMANENTLY / TEMPORARILY</span> → Closed · quota or network errors never change a status.
          </div>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ProfileCard({ me, onSaved }: { me: User | null; onSaved: (u: User) => void }) {
  const app = useApp();
  const [name, setName] = useState('');
  const [pwOpen, setPwOpen] = useState(false);
  const [cur, setCur] = useState('');
  const [nw, setNw] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (me) setName(me.name);
  }, [me]);

  const saveName = async () => {
    if (!name.trim() || !me) return;
    setBusy(true);
    try {
      const r = await api.auth.updateMe({ name: name.trim() });
      onSaved(r.user);
      app.toast('Profile saved');
    } catch (err) {
      app.toast('Could not save', errorMessage(err), { tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };

  const changePw = async () => {
    if (nw.length < 8) {
      app.toast('Password too short', 'Use at least 8 characters.', { tone: 'warn' });
      return;
    }
    setBusy(true);
    try {
      await api.auth.updateMe({ currentPassword: cur, newPassword: nw });
      setCur('');
      setNw('');
      setPwOpen(false);
      app.toast('Password updated', 'Other devices were signed out.');
    } catch (err) {
      app.toast('Could not update password', errorMessage(err), { tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ padding: '18px 20px' }}>
      <div className="card-title">Profile</div>
      {!me ? (
        <Skeleton h={90} style={{ marginTop: 12 }} />
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 14, flexWrap: 'wrap' }}>
            <span style={{ width: 52, height: 52, borderRadius: '50%', background: 'linear-gradient(135deg,var(--accent),var(--accentHover))', color: 'var(--accentFg)', fontSize: 17, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
              {me.name
                .split(/\s+/)
                .map((w) => w[0])
                .join('')
                .slice(0, 2)
                .toUpperCase()}
            </span>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>{me.name}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                {me.email} · {me.role === 'ADMIN' ? 'Admin' : 'Viewer'} · last sign-in {relTime(me.lastLoginAt)}
              </div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12, marginTop: 14 }}>
            <div>
              <label className="label">Full name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Full name" className="input" style={{ marginTop: 6 }} />
            </div>
            <div>
              <label className="label">Email</label>
              <input value={me.email} readOnly aria-label="Email" className="input" style={{ marginTop: 6, color: 'var(--muted)', background: 'var(--well)' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 9, marginTop: 14, flexWrap: 'wrap' }}>
            <button onClick={() => void saveName()} disabled={busy || name.trim() === me.name} className="btn btn-primary btn-sm">
              Save changes
            </button>
            <button onClick={() => setPwOpen((v) => !v)} className="btn btn-outline btn-sm">
              Change password
            </button>
          </div>
          {pwOpen ? (
            <div style={{ marginTop: 14, padding: 14, border: '1px solid var(--border)', borderRadius: 11, background: 'var(--well)', animation: 'slideUp .18s ease' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
                <div>
                  <label className="label">Current password</label>
                  <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} aria-label="Current password" className="input" style={{ marginTop: 6 }} autoComplete="current-password" />
                </div>
                <div>
                  <label className="label">New password</label>
                  <input type="password" value={nw} onChange={(e) => setNw(e.target.value)} placeholder="At least 8 characters" aria-label="New password" className="input" style={{ marginTop: 6 }} autoComplete="new-password" />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button onClick={() => void changePw()} disabled={busy || !cur || !nw} className="btn btn-primary btn-sm">
                  Update password
                </button>
                <button onClick={() => setPwOpen(false)} className="btn btn-outline btn-sm">
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------

function TeamCard({ me }: { me: User | null }) {
  const app = useApp();
  const [team, setTeam] = useState<User[] | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [role, setRole] = useState<UserRole>('VIEWER');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.users
      .list()
      .then((r) => setTeam(r.items))
      .catch((err) => app.toast('Could not load team', errorMessage(err), { tone: 'bad' }));
  }, [app]);

  useEffect(() => {
    load();
  }, [load]);

  const invite = async () => {
    if (!name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || pw.length < 8) {
      app.toast('Check the form', 'Name, a valid email and a password of at least 8 characters are required.', { tone: 'warn' });
      return;
    }
    setBusy(true);
    try {
      await api.users.create({ name: name.trim(), email: email.trim(), password: pw, role });
      setName('');
      setEmail('');
      setPw('');
      app.toast('Teammate added', 'Share the email and temporary password with them; they can change it under Settings.');
      load();
    } catch (err) {
      app.toast('Could not add teammate', errorMessage(err), { tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };

  const setUserRole = async (u: User, r: UserRole) => {
    try {
      await api.users.update(u.id, { role: r });
      load();
    } catch (err) {
      app.toast('Could not change role', errorMessage(err), { tone: 'bad' });
    }
  };

  const resetPw = (u: User) => {
    const p = window.prompt(`New temporary password for ${u.email} (at least 8 characters):`);
    if (!p) return;
    api.users
      .update(u.id, { password: p })
      .then(() => app.toast('Password reset', `${u.name} was signed out everywhere.`))
      .catch((err) => app.toast('Could not reset password', errorMessage(err), { tone: 'bad' }));
  };

  const remove = (u: User) => {
    app.askConfirm({
      title: `Remove ${u.name}?`,
      msg: `${u.email} will lose access immediately. Listings and history are not affected.`,
      label: 'Remove member',
      onYes: async () => {
        try {
          await api.users.remove(u.id);
          app.toast('Member removed', '', { tone: 'na' });
          load();
        } catch (err) {
          app.toast('Could not remove', errorMessage(err), { tone: 'bad' });
        }
      },
    });
  };

  return (
    <Card style={{ padding: '18px 20px' }}>
      <div className="card-title">Team</div>
      <div className="card-sub">Admins manage listings and settings. Viewers see dashboards and reports but cannot change anything.</div>
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 8 }}>
        {team === null ? (
          <Skeleton h={60} style={{ marginTop: 8 }} />
        ) : (
          team.map((u) => {
            const isMe = u.id === me?.id;
            return (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 0', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
                <span style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--surface2)', color: 'var(--muted)', fontSize: 11.5, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
                  {u.name
                    .split(/\s+/)
                    .map((w) => w[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase()}
                </span>
                <div style={{ flex: 1, minWidth: 150 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{u.name}</span>
                    {isMe ? <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--accentInk)', background: 'var(--accentSoft)', borderRadius: 5, padding: '1px 6px' }}>You</span> : null}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>
                    {u.email} · last sign-in {relTime(u.lastLoginAt)}
                  </div>
                </div>
                {isMe ? (
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', padding: '0 8px' }}>{u.role === 'ADMIN' ? 'Admin' : 'Viewer'}</span>
                ) : (
                  <>
                    <select value={u.role} onChange={(e) => void setUserRole(u, e.target.value as UserRole)} aria-label="Role" className="select" style={{ fontSize: 12, padding: '6px 26px 6px 10px', borderRadius: 8 }}>
                      <option value="ADMIN">Admin</option>
                      <option value="VIEWER">Viewer</option>
                    </select>
                    <button onClick={() => resetPw(u)} className="btn btn-outline btn-sm" style={{ padding: '6px 10px' }}>
                      Reset password
                    </button>
                    <button onClick={() => remove(u)} aria-label="Remove member" className="icon-btn" style={{ width: 28, height: 28, color: 'var(--bad)' }}>
                      <Icon d={IC.trash} size={13} />
                    </button>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
      <div style={{ marginTop: 14, padding: 12, border: '1px solid var(--border)', borderRadius: 11, background: 'var(--well)' }}>
        <div style={{ fontSize: 12.5, fontWeight: 800 }}>Add a teammate</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 8, marginTop: 8 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" aria-label="Name" className="input" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@agency.com" aria-label="Invite email" className="input" type="email" />
          <input value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Temporary password" aria-label="Temporary password" className="input" type="text" autoComplete="off" />
          <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} aria-label="Invite role" className="select" style={{ color: 'var(--text)' }}>
            <option value="VIEWER">Viewer</option>
            <option value="ADMIN">Admin</option>
          </select>
        </div>
        <button onClick={() => void invite()} disabled={busy} className="btn btn-soft btn-sm" style={{ marginTop: 10 }}>
          {busy ? <Icon d={IC.spinner} size={11} stroke={3} spin /> : <Icon d={IC.plus} size={11} stroke={2.4} />}
          Add member
        </button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function BackupCard() {
  const app = useApp();
  const [list, setList] = useState<BackupInfo[] | null>(null);
  const [dir, setDir] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api.backup
      .list()
      .then((r) => {
        setList(r.items);
        setDir(r.directory);
      })
      .catch((err) => app.toast('Could not load backups', errorMessage(err), { tone: 'bad' }));
  }, [app]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    try {
      const r = await api.backup.create();
      app.toast('Backup created', `${r.backup.name} · ${bytes(r.backup.size)}`);
      load();
      window.location.href = api.backup.downloadUrl(r.backup.name);
    } catch (err) {
      app.toast('Backup failed', errorMessage(err), { tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };

  const restore = (file: File | undefined) => {
    if (!file) return;
    app.askConfirm({
      title: 'Restore this backup?',
      msg: `The current database will be replaced by "${file.name}". A snapshot of the current data is saved first (pre-restore), so this can be undone.`,
      label: 'Restore backup',
      onYes: async () => {
        try {
          const r = await api.backup.restore(file);
          app.toast('Backup restored', `${r.listings} listings loaded. Previous data saved as ${r.preRestore.name}.`);
          app.bumpRefresh();
          load();
        } catch (err) {
          app.toast('Restore failed', errorMessage(err), { tone: 'bad' });
        }
      },
    });
    if (fileRef.current) fileRef.current.value = '';
  };

  const del = (b: BackupInfo) => {
    app.askConfirm({
      title: `Delete ${b.name}?`,
      msg: 'This backup file will be removed from the server.',
      label: 'Delete backup',
      onYes: async () => {
        try {
          await api.backup.remove(b.name);
          load();
        } catch (err) {
          app.toast('Could not delete', errorMessage(err), { tone: 'bad' });
        }
      },
    });
  };

  return (
    <Card style={{ padding: '18px 20px' }}>
      <div className="card-title">Backups</div>
      <div className="card-sub">A backup is taken automatically after every scheduled check (last 14 kept). Download one any time, or restore from a file.</div>
      <div style={{ display: 'flex', gap: 9, marginTop: 12, flexWrap: 'wrap' }}>
        <button onClick={() => void create()} disabled={busy} className="btn btn-primary btn-sm">
          {busy ? <Icon d={IC.spinner} size={11} stroke={3} spin color="#fff" /> : <Icon d={IC.download} size={12} stroke={2.2} />}
          Back up & download now
        </button>
        <button onClick={() => fileRef.current?.click()} className="btn btn-outline btn-sm">
          <Icon d={IC.upload} size={12} stroke={2.2} />
          Restore from file…
        </button>
        <input ref={fileRef} type="file" accept=".sqlite,.db,application/octet-stream" hidden onChange={(e) => restore(e.target.files?.[0])} />
        <a href={api.backup.keyUrl()} className="btn btn-outline btn-sm" style={{ textDecoration: 'none' }}>
          <Icon d={IC.file} size={12} stroke={2.2} />
          Download encryption key
        </a>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 8, lineHeight: 1.6 }}>
        Keep the encryption key with your backups: without it, stored account passwords and 2FA secrets in a backup cannot be read. Files live in <span className="mono">{dir || 'data/backups'}</span>.
      </div>
      <div style={{ marginTop: 12 }}>
        {list === null ? (
          <Skeleton h={40} />
        ) : list.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>No backups yet.</div>
        ) : (
          list.slice(0, 10).map((b) => (
            <div key={b.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--border)', fontSize: 12.5 }}>
              <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, color: b.kind === 'auto' ? 'var(--accentInk)' : b.kind === 'pre-restore' ? 'var(--warn)' : 'var(--muted)', background: 'var(--surface2)', borderRadius: 5, padding: '2px 7px', width: 84, textAlign: 'center' }}>
                {b.kind}
              </span>
              <span className="mono ell" style={{ flex: 1, fontSize: 11.5 }}>{b.name}</span>
              <span className="tnum" style={{ color: 'var(--faint)', whiteSpace: 'nowrap' }}>{bytes(b.size)}</span>
              <span className="tnum" style={{ color: 'var(--faint)', whiteSpace: 'nowrap' }} title={fdt(b.createdAt)}>
                {relTime(b.createdAt)}
              </span>
              <a href={api.backup.downloadUrl(b.name)} className="icon-btn" aria-label="Download backup" style={{ width: 28, height: 28 }}>
                <Icon d={IC.download} size={13} />
              </a>
              <button onClick={() => del(b)} className="icon-btn" aria-label="Delete backup" style={{ width: 28, height: 28, color: 'var(--bad)' }}>
                <Icon d={IC.trash} size={13} />
              </button>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------


/** Opens the "pull details from Google" dialog (field picker + overwrite option). */
function EnrichButton() {
  const [open, setOpen] = useState(false);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    api.listings
      .stats()
      .then((st) => setTotal(st.total))
      .catch(() => {});
  }, []);

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn btn-soft btn-sm" title="Uses 1 Google API call per listing">
        <Icon d={IC.refresh} size={12} stroke={2.2} />
        Pull phone, category &amp; address from Google
      </button>
      {open ? <EnrichModal onClose={() => setOpen(false)} selectedIds={[]} totalCount={total} /> : null}
    </>
  );
}

// ---------------------------------------------------------------------------

/** Deletes recorded status changes — used after a misconfiguration polluted the report. */
function ClearHistoryButton() {
  const app = useApp();
  const [busy, setBusy] = useState(false);

  const run = () =>
    app.askConfirm({
      title: 'Clear status history?',
      msg: 'Every recorded status change is deleted, so the suspension report and each listing’s History tab start empty. Current statuses and listings are not affected. Use this after test or misconfigured checks recorded changes that never really happened.',
      label: 'Clear history',
      onYes: async () => {
        setBusy(true);
        try {
          const r = await api.clearHistory();
          app.toast('History cleared', `${r.deleted} recorded status change${r.deleted === 1 ? '' : 's'} removed.`, { tone: 'na' });
          app.bumpRefresh();
        } catch (err) {
          app.toast('Could not clear history', errorMessage(err), { tone: 'bad' });
        } finally {
          setBusy(false);
        }
      },
    });

  return (
    <button onClick={run} disabled={busy} className="btn btn-outline btn-sm">
      {busy ? <Icon d={IC.spinner} size={11} stroke={3} spin /> : <Icon d={IC.trash} size={12} stroke={2.2} />}
      Clear status history
    </button>
  );
}
