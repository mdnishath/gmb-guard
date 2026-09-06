'use client';

import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { statusMeta, type UiStatus } from '@/lib/client/format';
import type { ListingStatus } from '@/lib/client/api';

// ---------------------------------------------------------------------------
// Icons (paths from the design)
// ---------------------------------------------------------------------------

export const IC = {
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z',
  store: 'M16 20V6a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v14 M2 9a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v11H2z M2 20h20',
  bars: 'M3 3v18h18 M8 17v-4 M13 17V7 M18 17v-7',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9 M10.3 21a1.94 1.94 0 0 0 3.4 0',
  clock: 'M12 7v5l3.5 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  zap: 'M13 2 3 14h9l-1 8 10-12h-9l1-8z',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z M12 1v2 M12 21v2 M4.2 4.2l1.4 1.4 M18.4 18.4l1.4 1.4 M1 12h2 M21 12h2 M4.2 19.8l1.4-1.4 M18.4 5.6l1.4-1.4',
  out: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
  check: 'M20 6 9 17l-5-5',
  x: 'M18 6 6 18 M6 6l12 12',
  alert: 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z M12 9v4 M12 17h.01',
  chl: 'M11 17l-5-5 5-5 M18 17l-5-5 5-5',
  chr: 'M13 17l5-5-5-5 M6 17l5-5-5-5',
  search: 'M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16z M21 21l-4.3-4.3',
  spinner: 'M21 12a9 9 0 1 1-6.2-8.56',
  refresh: 'M23 4v6h-6 M20.5 13a8.5 8.5 0 1 1-2-7.3L23 10',
  plus: 'M12 5v14 M5 12h14',
  ext: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6 M15 3h6v6 M10 14 21 3',
  edit: 'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z',
  trash: 'M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M10 11v6 M14 11v6',
  dots: 'M12 5v.01 M12 12v.01 M12 19v.01',
  arrow: 'M5 12h14 M12 5l7 7-7 7',
  back: 'M15 18l-6-6 6-6',
  fwd: 'M9 18l6-6-6-6',
  columns: 'M12 3v18 M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
  shield: 'M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3z M9 12l2 2 4-4',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z M14 2v6h6 M8 13h8 M8 17h8',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M22 6l-10 7L2 6',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  copy: 'M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2z M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
  send: 'M22 2 11 13 M22 2l-7 20-4-9-9-4 20-7z',
  pause: 'M6 4h4v16H6z M14 4h4v16h-4z',
  play: 'M5 3l14 9-14 9V3z',
};

export function Icon({ d, size = 15, stroke = 2, style, spin, color }: { d: string; size?: number; stroke?: number; style?: CSSProperties; spin?: boolean; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? 'currentColor'}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flex: '0 0 auto', ...(spin ? { animation: 'spin 1s linear infinite' } : {}), ...style }}
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

export function Spinner({ size = 13, color = 'var(--accentInk)' }: { size?: number; color?: string }) {
  return <Icon d={IC.spinner} size={size} stroke={2.4} spin color={color} />;
}

// ---------------------------------------------------------------------------
// Status pill
// ---------------------------------------------------------------------------

export function StatusPill({ status, small, pop, busy }: { status: ListingStatus | UiStatus; small?: boolean; pop?: boolean; busy?: boolean }) {
  if (busy) {
    return (
      <span className="pill" style={{ background: 'var(--warnBg)', borderColor: 'var(--warnBd)', color: 'var(--warn)' }}>
        <Icon d={IC.spinner} size={10} stroke={3} spin />
        <span>Checking…</span>
      </span>
    );
  }
  const m = statusMeta(status);
  return (
    <span
      role="status"
      aria-label={`Status: ${m.l}`}
      className="pill"
      style={{
        background: m.bg,
        borderColor: m.bd,
        color: m.c,
        ...(small ? { fontSize: 11, padding: '2px 9px 2px 7px' } : {}),
        ...(pop ? { animation: 'pop .55s ease' } : {}),
      }}
    >
      <span className="pill-dot" />
      <span>{m.l}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------

export function Toggle({ on, onChange, label, size = 'md' }: { on: boolean; onChange: (v: boolean) => void; label?: string; size?: 'md' | 'lg' }) {
  const w = size === 'lg' ? 40 : 36;
  const h = size === 'lg' ? 23 : 21;
  const k = size === 'lg' ? 18 : 16;
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      style={{ width: w, height: h, borderRadius: 999, background: on ? 'var(--accent)' : 'var(--border2)', position: 'relative', flex: '0 0 auto', transition: 'background .2s' }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2.5,
          left: on ? w - k - 2.5 : 2.5,
          width: k,
          height: k,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 2px rgba(0,0,0,.3)',
          transition: 'left .2s',
        }}
      />
    </button>
  );
}

export function Checkbox({ checked, onChange, label, size = 17 }: { checked: boolean; onChange: (e: MouseEvent<HTMLButtonElement>) => void; label?: string; size?: number }) {
  return (
    <button
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      style={{
        width: size,
        height: size,
        borderRadius: 5,
        border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--border2)'}`,
        background: checked ? 'var(--accent)' : 'var(--inputBg)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: '0 0 auto',
      }}
    >
      <svg width={size - 7} height={size - 7} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={4} style={{ opacity: checked ? 1 : 0 }}>
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </button>
  );
}

export function Radio({ on }: { on: boolean }) {
  return (
    <span
      style={{
        width: 15,
        height: 15,
        borderRadius: '50%',
        border: `1.5px solid ${on ? 'var(--accent)' : 'var(--border2)'}`,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: '0 0 auto',
        marginTop: 1,
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: on ? 'var(--accent)' : 'transparent' }} />
    </span>
  );
}

export function Field({ label, children, error, style }: { label: string; children: ReactNode; error?: string; style?: CSSProperties }) {
  return (
    <div style={style}>
      <label className="label">{label}</label>
      <div style={{ marginTop: 6 }}>{children}</div>
      {error ? <div className="err">{error}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

export function Card({ children, style, className }: { children: ReactNode; style?: CSSProperties; className?: string }) {
  return (
    <div className={`card card-pad ${className ?? ''}`} style={style}>
      {children}
    </div>
  );
}

export function CardHeader({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
      <div>
        <div className="card-title">{title}</div>
        {sub ? <div className="card-sub">{sub}</div> : null}
      </div>
      {right}
    </div>
  );
}

export function Skeleton({ h, style }: { h: number; style?: CSSProperties }) {
  return <div className="skel" style={{ height: h, ...style }} />;
}

export function EmptyState({ icon, title, sub, action }: { icon: string; title: string; sub?: string; action?: ReactNode }) {
  return (
    <div style={{ padding: '56px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
      <span
        style={{
          width: 52,
          height: 52,
          borderRadius: 14,
          background: 'var(--accentSoft)',
          color: 'var(--accentInk)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon d={icon} size={22} />
      </span>
      <div style={{ fontSize: 16, fontWeight: 800, marginTop: 14 }}>{title}</div>
      {sub ? <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 5, maxWidth: 380 }}>{sub}</div> : null}
      {action ? <div style={{ marginTop: 16 }}>{action}</div> : null}
    </div>
  );
}

export function Modal({ title, onClose, children, width = 480, zIndex = 70 }: { title: string; onClose: () => void; children: ReactNode; width?: number; zIndex?: number }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'var(--scrim)', animation: 'fadeIn .15s' }} />
      <div
        role="dialog"
        aria-label={title}
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%,-50%)',
          width: `min(${width}px, calc(100vw - 32px))`,
          maxHeight: '88vh',
          overflowY: 'auto',
          background: 'var(--surface)',
          border: '1px solid var(--border2)',
          borderRadius: 16,
          boxShadow: 'var(--shadowLg)',
          padding: 22,
          animation: 'slideUp .2s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{title}</div>
          <button onClick={onClose} aria-label="Close" className="ghost-btn" style={{ width: 28, height: 28 }}>
            <Icon d={IC.x} size={15} stroke={2.4} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Pager({
  page,
  totalPages,
  onPage,
  info,
  pageSize,
  onPageSize,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
  info: string;
  pageSize?: number;
  onPageSize?: (n: number) => void;
}) {
  const pages: Array<number | 'dots'> = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push('dots');
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
    if (page < totalPages - 2) pages.push('dots');
    pages.push(totalPages);
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', flexWrap: 'wrap' }}>
      <span className="tnum" style={{ fontSize: 12, color: 'var(--muted)' }}>
        {info}
      </span>
      <div style={{ flex: 1 }} />
      {onPageSize ? (
        <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} aria-label="Rows per page" className="select" style={{ padding: '5px 24px 5px 9px', fontSize: 12, borderRadius: 8 }}>
          <option value={25}>25 / page</option>
          <option value={50}>50 / page</option>
          <option value={100}>100 / page</option>
        </select>
      ) : null}
      {page > 1 ? (
        <button onClick={() => onPage(page - 1)} aria-label="Previous page" className="icon-btn" style={{ width: 28, height: 28, borderRadius: 8, borderColor: 'var(--border2)' }}>
          <Icon d={IC.back} size={13} stroke={2.4} />
        </button>
      ) : null}
      {pages.map((p, i) =>
        p === 'dots' ? (
          <span key={`d${i}`} style={{ color: 'var(--faint)', fontSize: 12, padding: '0 2px' }}>
            …
          </span>
        ) : (
          <button
            key={p}
            onClick={() => onPage(p)}
            className="tnum"
            style={{
              minWidth: 28,
              height: 28,
              borderRadius: 8,
              background: p === page ? 'var(--accent)' : 'transparent',
              color: p === page ? 'var(--accentFg)' : 'var(--muted)',
              fontSize: 12,
              fontWeight: 700,
              padding: '0 6px',
            }}
          >
            {p}
          </button>
        ),
      )}
      {page < totalPages ? (
        <button onClick={() => onPage(page + 1)} aria-label="Next page" className="icon-btn" style={{ width: 28, height: 28, borderRadius: 8, borderColor: 'var(--border2)' }}>
          <Icon d={IC.fwd} size={13} stroke={2.4} />
        </button>
      ) : null}
    </div>
  );
}

export function Donut({ segments, size = 130, center, sub }: { segments: Array<{ color: string; value: number }>; size?: number; center: string; sub: string }) {
  const C = 339.292;
  const total = segments.reduce((a, s) => a + s.value, 0);
  let acc = 0;
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: '0 0 auto' }}>
      <svg viewBox="0 0 130 130" style={{ width: size, height: size, transform: 'rotate(-90deg)' }}>
        <circle cx="65" cy="65" r="54" fill="none" stroke="var(--surface2)" strokeWidth="13" />
        {segments.map((s, i) => {
          const len = total ? (s.value / total) * C : 0;
          const el = <circle key={i} cx="65" cy="65" r="54" fill="none" stroke={s.color} strokeWidth="13" strokeDasharray={`${len.toFixed(1)} ${(C - len).toFixed(1)}`} strokeDashoffset={(-acc).toFixed(1)} />;
          acc += len;
          return el;
        })}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: size > 120 ? 21 : 19, fontWeight: 800, letterSpacing: -0.5 }}>{center}</span>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{sub}</span>
      </div>
    </div>
  );
}

export function TrendChart({ points, labels, cx, cy, line, area }: { points: number[]; labels: string[]; cx: number; cy: number; line: string; area: string }) {
  return (
    <>
      <svg viewBox="0 0 640 170" preserveAspectRatio="none" style={{ width: '100%', height: 170, display: 'block', marginTop: 14, overflow: 'visible' }}>
        <line x1="0" x2="640" y1="128" y2="128" stroke="var(--border)" strokeDasharray="3 5" />
        <line x1="0" x2="640" y1="86" y2="86" stroke="var(--border)" strokeDasharray="3 5" />
        <line x1="0" x2="640" y1="44" y2="44" stroke="var(--border)" strokeDasharray="3 5" />
        <line x1="0" x2="640" y1="169" y2="169" stroke="var(--border)" />
        {points.length ? (
          <>
            <path d={area} fill="var(--badBg)" opacity="0.75" />
            <path d={line} fill="none" stroke="var(--bad)" strokeWidth="2.4" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            <circle cx={cx} cy={cy} r="4.5" fill="var(--bad)" stroke="var(--surface)" strokeWidth="2" />
          </>
        ) : null}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
        {labels.map((x, i) => (
          <span key={i} style={{ fontSize: 11, color: 'var(--faint)' }}>
            {x}
          </span>
        ))}
      </div>
    </>
  );
}
