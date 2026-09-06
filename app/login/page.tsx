'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { IC, Icon } from '@/components/ui';
import { api, ApiClientError } from '@/lib/client/api';

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/';

  const [mode, setMode] = useState<'loading' | 'login' | 'signup'>('loading');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});
  const [wide, setWide] = useState(true);

  useEffect(() => {
    const onRes = () => setWide(window.innerWidth >= 900);
    onRes();
    window.addEventListener('resize', onRes);
    return () => window.removeEventListener('resize', onRes);
  }, []);

  useEffect(() => {
    api.auth
      .status()
      .then((s) => {
        if (s.user) {
          router.replace(next);
          return;
        }
        setMode(s.signupOpen ? 'signup' : 'login');
      })
      .catch(() => setMode('login'));
  }, [router, next]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (mode === 'signup' && !name.trim()) errs.name = 'Enter your name';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errs.email = 'Enter a valid email';
    if (!pw) errs.pw = 'Enter your password';
    else if (mode === 'signup' && pw.length < 8) errs.pw = 'Use at least 8 characters';
    if (Object.keys(errs).length) {
      setErr(errs);
      return;
    }
    setBusy(true);
    setErr({});
    try {
      if (mode === 'signup') await api.auth.signup({ name: name.trim(), email: email.trim(), password: pw });
      else await api.auth.login({ email: email.trim(), password: pw, remember });
      router.replace(next);
      router.refresh();
    } catch (error) {
      const msg = error instanceof ApiClientError ? error.message : 'Something went wrong';
      setErr({ form: msg });
      if (error instanceof ApiClientError && error.status === 403 && mode === 'signup') setMode('login');
    } finally {
      setBusy(false);
    }
  };

  const pwStrength = pw.length === 0 ? 0 : pw.length < 8 ? 1 : /[A-Z]/.test(pw) && /\d/.test(pw) && pw.length >= 12 ? 3 : 2;
  const strengthColor = (i: number) => (pwStrength >= i ? (pwStrength === 1 ? 'var(--bad)' : pwStrength === 2 ? 'var(--warn)' : 'var(--ok)') : 'var(--surface2)');

  const Logo = ({ light }: { light?: boolean }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ width: 32, height: 32, borderRadius: 9, background: 'var(--accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon d={IC.shield} size={18} stroke={2.2} color={light ? '#fff' : 'var(--accentFg)'} />
      </span>
      <span style={{ fontWeight: 800, fontSize: 16.5, letterSpacing: -0.3 }}>GMB Guard</span>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: wide ? '1.05fr 1fr' : '1fr', background: 'var(--bg)', color: 'var(--text)' }}>
      {wide ? (
        <div style={{ background: '#0D1120', color: '#EAEEF5', display: 'flex', flexDirection: 'column', padding: '44px 48px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(600px 400px at 20% 0%, rgba(94,98,238,.22), transparent 65%)' }} />
          <div style={{ position: 'relative' }}>
            <Logo light />
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', position: 'relative', maxWidth: 430 }}>
            <h2 style={{ fontSize: 33, fontWeight: 800, letterSpacing: -1, lineHeight: 1.15 }}>Never lose a listing silently.</h2>
            <p style={{ fontSize: 14.5, color: '#9AA4B6', marginTop: 12, lineHeight: 1.65 }}>
              GMB Guard checks every Google Business Profile you manage, every day — and alerts you the moment one is suspended, disappears, or comes back live.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 26 }}>
              {[
                { dot: '#F87168', t: 'Magnolia Roofing Co. suspended', s: 'Alert sent 40 seconds after detection', at: '03:00' },
                { dot: '#3ECF8E', t: 'Bright Smile Dental back live', s: 'Recovered after 6 days — client notified', at: '03:01' },
              ].map((c) => (
                <div key={c.t} style={{ display: 'flex', alignItems: 'center', gap: 11, background: 'rgba(255,255,255,.045)', border: '1px solid rgba(255,255,255,.09)', borderRadius: 12, padding: '11px 14px' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.dot, flex: '0 0 auto' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700 }}>{c.t}</div>
                    <div style={{ fontSize: 11, color: '#8791A3' }}>{c.s}</div>
                  </div>
                  <span style={{ fontSize: 10.5, color: '#8791A3', flex: '0 0 auto' }}>{c.at}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ fontSize: 12, color: '#8791A3', position: 'relative' }}>Self-hosted · your data stays on your server</div>
        </div>
      ) : null}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 24px' }}>
        <form onSubmit={(e) => void submit(e)} style={{ width: 'min(390px, 100%)' }} noValidate>
          {!wide ? (
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 26 }}>
              <Logo />
            </div>
          ) : null}

          {mode === 'loading' ? (
            <div style={{ display: 'grid', gap: 10 }}>
              <div className="skel" style={{ height: 28, width: '60%' }} />
              <div className="skel" style={{ height: 14, width: '80%' }} />
              <div className="skel" style={{ height: 120, marginTop: 10 }} />
            </div>
          ) : (
            <>
              <h1 style={{ fontSize: 23, fontWeight: 800, letterSpacing: -0.5 }}>{mode === 'signup' ? 'Create your workspace' : 'Welcome back'}</h1>
              <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
                {mode === 'signup' ? 'First account becomes the admin. Teammates are added later under Settings → Team.' : 'Sign in to your GMB Guard workspace.'}
              </p>

              {mode === 'signup' ? (
                <>
                  <label className="label" style={{ display: 'block', marginTop: 20 }}>Full name</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sarah Mitchell" aria-label="Full name" className={`input ${err.name ? 'invalid' : ''}`} style={{ marginTop: 6 }} autoComplete="name" autoFocus />
                  {err.name ? <div className="err">{err.name}</div> : null}
                </>
              ) : null}

              <label className="label" style={{ display: 'block', marginTop: mode === 'signup' ? 14 : 20 }}>Work email</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@agency.com" aria-label="Email" type="email" className={`input ${err.email ? 'invalid' : ''}`} style={{ marginTop: 6 }} autoComplete="email" autoFocus={mode === 'login'} />
              {err.email ? <div className="err">{err.email}</div> : null}

              <label className="label" style={{ display: 'block', marginTop: 14 }}>Password</label>
              <div style={{ position: 'relative', marginTop: 6 }}>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  placeholder={mode === 'signup' ? 'At least 8 characters' : '••••••••'}
                  aria-label="Password"
                  className={`input ${err.pw ? 'invalid' : ''}`}
                  style={{ paddingRight: 42 }}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                />
                <button type="button" onClick={() => setShowPw((v) => !v)} aria-label="Toggle password visibility" className="ghost-btn" style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', width: 30, height: 30, color: showPw ? 'var(--accentInk)' : 'var(--faint)' }}>
                  <Icon d={IC.eye} size={15} />
                </button>
              </div>
              {mode === 'signup' ? (
                <div style={{ display: 'flex', gap: 5, marginTop: 8, alignItems: 'center' }}>
                  {[1, 2, 3].map((i) => (
                    <span key={i} style={{ flex: 1, height: 4, borderRadius: 3, background: strengthColor(i) }} />
                  ))}
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--faint)', marginLeft: 6 }}>{pwStrength === 0 ? '' : pwStrength === 1 ? 'Too short' : pwStrength === 2 ? 'OK' : 'Strong'}</span>
                </div>
              ) : null}
              {err.pw ? <div className="err">{err.pw}</div> : null}

              {mode === 'login' ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={remember}
                    onClick={() => setRemember((v) => !v)}
                    style={{ width: 16, height: 16, borderRadius: 5, border: `1.5px solid ${remember ? 'var(--accent)' : 'var(--border2)'}`, background: remember ? 'var(--accent)' : 'var(--inputBg)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}
                  >
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4" style={{ opacity: remember ? 1 : 0 }}>
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </button>
                  <span style={{ flex: 1, fontSize: 12.5, color: 'var(--muted)', fontWeight: 600 }}>Remember me for 30 days</span>
                </div>
              ) : null}

              {err.form ? (
                <div style={{ marginTop: 14, padding: '9px 12px', borderRadius: 9, background: 'var(--badBg)', border: '1px solid var(--badBd)', color: 'var(--bad)', fontSize: 12.5, fontWeight: 600 }}>{err.form}</div>
              ) : null}

              <button type="submit" disabled={busy} className="btn btn-primary" style={{ width: '100%', marginTop: 18, justifyContent: 'center', fontSize: 13.5, fontWeight: 800, padding: 11, borderRadius: 10, boxShadow: 'var(--shadowMd)' }}>
                {busy ? <Icon d={IC.spinner} size={13} stroke={3} spin color="#fff" /> : null}
                {mode === 'signup' ? 'Create workspace' : 'Sign in'}
              </button>

              <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 14, textAlign: 'center', lineHeight: 1.6 }}>
                {mode === 'signup' ? 'You can change your password any time under Settings.' : 'Forgot your password? Another admin can reset it under Settings → Team.'}
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
