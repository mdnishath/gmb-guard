'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { api, type AuditLog, type User } from '@/lib/client/api';
import { countdown, initials, nextCronRun, relTime, statusMeta } from '@/lib/client/format';
import { useApp } from './app-context';
import { IC, Icon } from './ui';
import { ListingDrawer } from './listing-drawer';

const NAV = [
  { href: '/', label: 'Dashboard', d: IC.grid },
  { href: '/businesses', label: 'Businesses', d: IC.store },
  { href: '/reports', label: 'Reports', d: IC.bars },
  { href: '/alerts', label: 'Notifications', d: IC.bell },
  { href: '/schedule', label: 'Schedule', d: IC.clock },
  { href: '/settings', label: 'Settings', d: IC.gear },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === '/login') {
    return (
      <>
        {children}
        <Toasts />
      </>
    );
  }
  return <Shell>{children}</Shell>;
}

function Shell({ children }: { children: ReactNode }) {
  const app = useApp();
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<User | null>(null);

  useEffect(() => {
    api.auth
      .me()
      .then((r) => setMe(r.user))
      .catch(() => {});
  }, []);

  const signOut = async () => {
    try {
      await api.auth.logout();
    } catch {
      /* ignore */
    }
    window.location.href = '/login';
  };
  const mainRef = useRef<HTMLElement>(null);
  const [bellOpen, setBellOpen] = useState(false);
  const [avOpen, setAvOpen] = useState(false);
  const [bellItems, setBellItems] = useState<AuditLog[]>([]);
  const [seenAt, setSeenAt] = useState<number>(0);
  const [cron, setCron] = useState<string>('0 3 * * *');
  const [tick, setTick] = useState(0);

  const lg = app.vw === 'lg';
  const open = lg && app.sideOpen;

  useEffect(() => {
    try {
      setSeenAt(Number(localStorage.getItem('gmb-bell-seen') ?? 0));
    } catch {
      /* ignore */
    }
    api.settings
      .get()
      .then((s) => setCron(s.cron.schedule))
      .catch(() => {});
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    api
      .auditLogs({ pageSize: 6 })
      .then((r) => setBellItems(r.items))
      .catch(() => {});
  }, [app.refreshKey, app.checkAll.running]);

  useEffect(() => {
    mainRef.current?.scrollTo(0, 0);
    setBellOpen(false);
    setAvOpen(false);
  }, [pathname]);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const target = e.target as HTMLElement | null;
      const typing = !!target && /input|textarea|select/i.test(target.tagName);
      if ((e.metaKey || e.ctrlKey) && k === 'k') {
        e.preventDefault();
        app.setCmdOpen(!app.cmdOpen);
        return;
      }
      if (k === 'escape') {
        if (app.cmdOpen || bellOpen || avOpen) {
          app.setCmdOpen(false);
          setBellOpen(false);
          setAvOpen(false);
        } else if (app.confirm) app.closeConfirm();
        else if (app.drawerId) app.closeDrawer();
        return;
      }
      if (!typing && k === 'c' && !e.metaKey && !e.ctrlKey && !app.cmdOpen && !app.confirm) void app.startCheckAll();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app, bellOpen, avOpen]);

  const unread = useMemo(() => bellItems.filter((b) => new Date(b.checkedAt).getTime() > seenAt).length, [bellItems, seenAt]);
  const markRead = () => {
    const now = Date.now();
    setSeenAt(now);
    try {
      localStorage.setItem('gmb-bell-seen', String(now));
    } catch {
      /* ignore */
    }
  };

  const next = useMemo(() => countdown(nextCronRun(cron)), [cron, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href) || (href === '/businesses' && pathname.startsWith('/import')));

  const ck = app.checkAll;
  const estPct = ck.running && ck.total ? Math.max(3, Math.round((ck.done / ck.total) * 100)) : 0;

  return (
    <div style={{ display: 'flex', height: '100vh', minWidth: 0, overflow: 'hidden' }}>
      <aside
        aria-label="Main navigation"
        style={{
          width: open ? 224 : 62,
          flex: '0 0 auto',
          background: 'var(--surface)',
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          padding: '14px 10px 12px',
          gap: 3,
          height: '100vh',
          transition: 'width .22s cubic-bezier(.2,.8,.3,1)',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 6px 16px' }}>
          <span style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto', boxShadow: 'var(--shadowMd)' }}>
            <Icon d={IC.shield} size={17} stroke={2.2} color="var(--accentFg)" />
          </span>
          {open ? <span style={{ fontWeight: 800, fontSize: 15.5, letterSpacing: -0.3, whiteSpace: 'nowrap' }}>GMB Guard</span> : null}
        </div>
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} title={n.label} className={`nav-item ${isActive(n.href) ? 'active' : ''}`}>
            <Icon d={n.d} size={17} stroke={1.9} />
            {open ? <span className="ell">{n.label}</span> : null}
          </Link>
        ))}
        <div style={{ flex: 1 }} />
        {open ? (
          <div style={{ padding: '10px 11px', borderRadius: 10, background: 'var(--well)', border: '1px solid var(--border)', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, fontWeight: 700, color: 'var(--ok)' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--ok)', animation: 'pulse 2.4s infinite' }} />
              <span>Monitoring active</span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>Next check {next.short}</div>
          </div>
        ) : null}
        {lg ? (
          <button onClick={app.toggleSide} aria-label="Toggle sidebar" title={open ? 'Collapse' : 'Expand'} className="nav-item" style={{ color: 'var(--faint)', fontSize: 12.5, padding: '8px 10px' }}>
            <Icon d={open ? IC.chl : IC.chr} size={16} />
            {open ? <span style={{ whiteSpace: 'nowrap' }}>Collapse</span> : null}
          </button>
        ) : null}
      </aside>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <header style={{ height: 58, flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 9, padding: '0 16px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', position: 'relative', zIndex: 30 }}>
          <button
            onClick={() => app.setCmdOpen(true)}
            aria-label="Search — Command K"
            style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 9, padding: '7px 11px', color: 'var(--faint)', fontSize: 13, flex: '0 1 400px', minWidth: 0, textAlign: 'left' }}
          >
            <Icon d={IC.search} size={14} />
            <span className="ell" style={{ flex: 1 }}>
              Search listings, run actions…
            </span>
            <span className="kbd">⌘K</span>
          </button>
          <div style={{ flex: 1 }} />
          {ck.running ? (
            <div className="tnum" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted)', flex: '0 0 auto' }}>
              <Icon d={IC.spinner} size={13} stroke={2.4} spin color="var(--accentInk)" />
              <span>
                {ck.done} / {ck.total}
                {ck.changed ? <span style={{ color: 'var(--bad)', fontWeight: 700 }}> · {ck.changed} changed</span> : null}
                {ck.errors ? <span style={{ color: 'var(--warn)', fontWeight: 700 }}> · {ck.errors} errors</span> : null}
              </span>
              <button onClick={app.cancelCheckAll} className="btn btn-outline btn-sm" style={{ padding: '4px 9px', fontSize: 11.5 }}>
                Stop
              </button>
            </div>
          ) : null}
          <button onClick={() => void app.startCheckAll()} disabled={ck.running} title="Check all listings (C)" className="btn btn-primary">
            <Icon d={IC.zap} size={13} stroke={2.2} />
            <span>Check all</span>
          </button>
          <button onClick={app.toggleTheme} aria-label="Toggle color theme" className="icon-btn">
            <span style={{ position: 'absolute', display: 'inline-flex', opacity: app.theme === 'dark' ? 0 : 1, transform: `rotate(${app.theme === 'dark' ? '-60deg' : '0deg'})`, transition: 'opacity .25s,transform .4s' }}>
              <Icon d={IC.sun} size={15} />
            </span>
            <span style={{ position: 'absolute', display: 'inline-flex', opacity: app.theme === 'dark' ? 1 : 0, transform: `rotate(${app.theme === 'dark' ? '0deg' : '60deg'})`, transition: 'opacity .25s,transform .4s' }}>
              <Icon d={IC.moon} size={15} />
            </span>
          </button>
          <div style={{ position: 'relative', flex: '0 0 auto' }}>
            <button
              onClick={() => {
                setBellOpen((v) => !v);
                setAvOpen(false);
              }}
              aria-label="Notifications"
              className="icon-btn"
            >
              <Icon d={IC.bell} size={15} />
              {unread > 0 ? (
                <span style={{ position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 999, background: 'var(--bad)', color: '#fff', fontSize: 9.5, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', border: '2px solid var(--surface)' }}>
                  {unread}
                </span>
              ) : null}
            </button>
            {bellOpen ? (
              <div role="menu" style={{ position: 'absolute', right: 0, top: 42, width: 330, background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 13, boxShadow: 'var(--shadowLg)', zIndex: 50, animation: 'slideUp .18s ease', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>Recent status changes</span>
                  <button onClick={markRead} className="link-btn" style={{ fontSize: 11.5 }}>
                    Mark all read
                  </button>
                </div>
                {bellItems.length === 0 ? (
                  <div style={{ padding: '18px 14px', fontSize: 12.5, color: 'var(--muted)' }}>No status changes yet.</div>
                ) : (
                  bellItems.map((b) => {
                    const m = statusMeta(b.newStatus);
                    const label = b.newStatus === 'ACTIVE' ? 'Back live' : b.newStatus === 'SUSPENDED' ? 'Suspended' : 'Closed';
                    const isNew = new Date(b.checkedAt).getTime() > seenAt;
                    return (
                      <button
                        key={b.id}
                        onClick={() => {
                          setBellOpen(false);
                          app.openDrawer(b.listingId);
                        }}
                        className="row-hover"
                        style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 14px', width: '100%', textAlign: 'left', borderBottom: '1px solid var(--border)' }}
                      >
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: m.c, marginTop: 5, flex: '0 0 auto' }} />
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span className="ell" style={{ display: 'block', fontSize: 12.5, fontWeight: 600 }}>
                            {label}: {b.listing?.name ?? 'Deleted listing'}
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--faint)' }}>{relTime(b.checkedAt)}</span>
                        </span>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: isNew ? 'var(--accentInk)' : 'transparent', marginTop: 5, flex: '0 0 auto' }} />
                      </button>
                    );
                  })
                )}
                <Link href="/alerts" onClick={() => setBellOpen(false)} className="link-btn" style={{ display: 'block', width: '100%', padding: 10, fontSize: 12, textAlign: 'center' }}>
                  Notification settings →
                </Link>
              </div>
            ) : null}
          </div>
          <div style={{ position: 'relative', flex: '0 0 auto' }}>
            <button
              onClick={() => {
                setAvOpen((v) => !v);
                setBellOpen(false);
              }}
              aria-label="Account menu"
              style={{ display: 'inline-flex', alignItems: 'center' }}
            >
              <span style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg,var(--accent),var(--accentHover))', color: 'var(--accentFg)', fontSize: 11.5, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', letterSpacing: 0.3 }}>
                {initials(me?.name ?? 'GMB Guard')}
              </span>
            </button>
            {avOpen ? (
              <div role="menu" style={{ position: 'absolute', right: 0, top: 42, width: 232, background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 13, boxShadow: 'var(--shadowLg)', zIndex: 50, animation: 'slideUp .18s ease', overflow: 'hidden' }}>
                <div style={{ padding: '11px 13px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{me?.name ?? 'GMB Guard'}</div>
                  <div className="ell" style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                    {me ? `${me.email} · ${me.role === 'ADMIN' ? 'Admin' : 'Viewer'}` : 'Self-hosted workspace'}
                  </div>
                </div>
                <Link href="/settings" className="menu-row" onClick={() => setAvOpen(false)}>
                  <Icon d={IC.gear} size={14} />
                  <span>Profile & settings</span>
                </Link>
                <Link href="/alerts" className="menu-row" onClick={() => setAvOpen(false)}>
                  <Icon d={IC.bell} size={14} />
                  <span>Notifications</span>
                </Link>
                <button onClick={() => void signOut()} className="menu-row" style={{ width: '100%', color: 'var(--bad)', borderTop: '1px solid var(--border)' }}>
                  <Icon d={IC.out} size={14} />
                  <span>Sign out</span>
                </button>
              </div>
            ) : null}
          </div>
        </header>

        {ck.running ? (
          <div style={{ height: 3, background: 'var(--surface2)', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${estPct}%`, background: 'var(--accent)', transition: 'width 1s linear' }} />
          </div>
        ) : null}

        <main ref={mainRef} style={{ flex: 1, minWidth: 0, overflowY: 'auto', overscrollBehavior: 'contain', position: 'relative' }}>
          {children}
        </main>
      </div>

      {(bellOpen || avOpen) && (
        <div
          onClick={() => {
            setBellOpen(false);
            setAvOpen(false);
          }}
          style={{ position: 'fixed', inset: 0, zIndex: 20 }}
        />
      )}

      {app.drawerId ? <ListingDrawer /> : null}
      {app.cmdOpen ? <CommandPalette onNavigate={(href) => router.push(href)} /> : null}
      <ConfirmDialog />
      <Toasts />
    </div>
  );
}

// ---------------------------------------------------------------------------

function CommandPalette({ onNavigate }: { onNavigate: (href: string) => void }) {
  const app = useApp();
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);

  const cmds = useMemo(() => {
    const go = (href: string) => () => {
      app.setCmdOpen(false);
      onNavigate(href);
    };
    const list = [
      ...NAV.map((n) => ({ s: 'Go to', l: n.label, d: n.d, run: go(n.href) })),
      { s: 'Action', l: 'Check all listings now', d: IC.zap, run: () => { app.setCmdOpen(false); void app.startCheckAll(); } },
      { s: 'Action', l: 'Add business', d: IC.plus, run: go('/businesses?add=1') },
      { s: 'Action', l: 'Import businesses', d: IC.upload, run: go('/import') },
      { s: 'Action', l: 'Export businesses', d: IC.download, run: go('/businesses?export=1') },
      { s: 'Action', l: 'Toggle theme', d: IC.moon, run: () => { app.setCmdOpen(false); app.toggleTheme(); } },
    ];
    const ql = q.toLowerCase();
    return list.filter((c) => c.l.toLowerCase().includes(ql));
  }, [q, app, onNavigate]);

  const onKey = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setIdx((i) => Math.min(cmds.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setIdx((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter' && cmds[idx]) cmds[idx].run();
    },
    [cmds, idx],
  );

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 80 }}>
      <div onClick={() => app.setCmdOpen(false)} style={{ position: 'absolute', inset: 0, background: 'var(--scrim)', animation: 'fadeIn .15s' }} />
      <div role="dialog" aria-label="Command palette" style={{ position: 'absolute', left: '50%', top: '13vh', transform: 'translateX(-50%)', width: 'min(560px, calc(100vw - 32px))', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 15, boxShadow: 'var(--shadowLg)', overflow: 'hidden', animation: 'slideUp .18s ease' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px', borderBottom: '1px solid var(--border)' }}>
          <Icon d={IC.search} size={15} color="var(--faint)" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setIdx(0);
            }}
            onKeyDown={onKey}
            placeholder="Search pages and actions…"
            aria-label="Command search"
            style={{ flex: 1, border: 0, outline: 0, background: 'transparent', fontSize: 14.5, color: 'var(--text)' }}
          />
          <span className="kbd">esc</span>
        </div>
        <div style={{ maxHeight: 340, overflowY: 'auto', padding: 6 }}>
          {cmds.map((cm, i) => (
            <button key={cm.l} onClick={cm.run} onMouseEnter={() => setIdx(i)} style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', padding: '9px 11px', borderRadius: 9, background: i === idx ? 'var(--surface2)' : 'transparent', textAlign: 'left' }}>
              <Icon d={cm.d} size={15} stroke={1.9} color="var(--muted)" />
              <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>{cm.l}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{cm.s}</span>
            </button>
          ))}
          {cmds.length === 0 ? <div style={{ padding: '14px 11px', fontSize: 12.5, color: 'var(--muted)' }}>No matches.</div> : null}
        </div>
        <div style={{ display: 'flex', gap: 14, padding: '9px 16px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--faint)' }}>
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}

function ConfirmDialog() {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const c = app.confirm;
  if (!c) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 85 }}>
      <div onClick={app.closeConfirm} style={{ position: 'absolute', inset: 0, background: 'var(--scrim)', animation: 'fadeIn .15s' }} />
      <div role="alertdialog" aria-label={c.title} style={{ position: 'absolute', left: '50%', top: '32vh', transform: 'translateX(-50%)', width: 'min(420px, calc(100vw - 32px))', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 15, boxShadow: 'var(--shadowLg)', padding: 20, animation: 'slideUp .18s ease' }}>
        <div style={{ display: 'flex', gap: 13, alignItems: 'flex-start' }}>
          <span style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--badBg)', color: 'var(--bad)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
            <Icon d={IC.alert} size={16} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{c.title}</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4, lineHeight: 1.55 }}>{c.msg}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', marginTop: 18 }}>
          <button onClick={app.closeConfirm} className="btn btn-outline" style={{ fontSize: 13 }}>
            Cancel
          </button>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await c.onYes();
              } finally {
                setBusy(false);
                app.closeConfirm();
              }
            }}
            className="btn btn-danger-solid"
            style={{ fontSize: 13 }}
          >
            {busy ? <Icon d={IC.spinner} size={12} stroke={3} spin color="#fff" /> : null}
            {c.label}
          </button>
        </div>
      </div>
    </div>
  );
}

function Toasts() {
  const app = useApp();
  const tone = (t: string) =>
    t === 'bad' ? { bg: 'var(--badBg)', c: 'var(--bad)', d: IC.alert } : t === 'warn' ? { bg: 'var(--warnBg)', c: 'var(--warn)', d: IC.alert } : t === 'na' ? { bg: 'var(--naBg)', c: 'var(--na)', d: IC.x } : { bg: 'var(--okBg)', c: 'var(--ok)', d: IC.check };
  return (
    <div aria-live="polite" style={{ position: 'fixed', right: 18, bottom: 18, display: 'flex', flexDirection: 'column', gap: 10, zIndex: 90, maxWidth: 'min(380px, calc(100vw - 36px))' }}>
      {app.toasts.map((t) => {
        const m = tone(t.tone);
        return (
          <div key={t.id} style={{ display: 'flex', gap: 11, alignItems: 'flex-start', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 12, padding: '12px 14px', boxShadow: 'var(--shadowLg)', animation: 'slideIn .28s cubic-bezier(.2,.8,.3,1)' }}>
            <span style={{ width: 26, height: 26, borderRadius: 8, background: m.bg, color: m.c, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto', marginTop: 1 }}>
              <Icon d={m.d} size={13} stroke={2.4} />
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{t.title}</div>
              {t.msg ? <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 1 }}>{t.msg}</div> : null}
              {t.actLabel && t.act ? (
                <button
                  onClick={() => {
                    t.act?.();
                    app.dismissToast(t.id);
                  }}
                  className="link-btn"
                  style={{ marginTop: 6 }}
                >
                  {t.actLabel}
                </button>
              ) : null}
            </div>
            <button onClick={() => app.dismissToast(t.id)} aria-label="Dismiss" style={{ color: 'var(--faint)' }}>
              <Icon d={IC.x} size={13} stroke={2.4} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
