import type { Listing, ListingStatus } from './api';

/** UI status: the three DB statuses plus "pending" for never-checked listings. */
export type UiStatus = 'live' | 'susp' | 'closed' | 'pend';

export interface StatusMeta {
  l: string;
  c: string;
  bg: string;
  bd: string;
}

export const STATUS: Record<UiStatus, StatusMeta> = {
  live: { l: 'Live', c: 'var(--ok)', bg: 'var(--okBg)', bd: 'var(--okBd)' },
  susp: { l: 'Suspended', c: 'var(--bad)', bg: 'var(--badBg)', bd: 'var(--badBd)' },
  closed: { l: 'Closed', c: 'var(--na)', bg: 'var(--naBg)', bd: 'var(--naBd)' },
  pend: { l: 'Pending', c: 'var(--warn)', bg: 'var(--warnBg)', bd: 'var(--warnBd)' },
};

export function dbToUi(status: ListingStatus): UiStatus {
  return status === 'ACTIVE' ? 'live' : status === 'SUSPENDED' ? 'susp' : 'closed';
}

export function uiStatus(l: Pick<Listing, 'currentStatus' | 'lastCheckedAt'>): UiStatus {
  if (!l.lastCheckedAt) return 'pend';
  return dbToUi(l.currentStatus);
}

export function statusMeta(status: ListingStatus | UiStatus): StatusMeta {
  const key = (status === 'ACTIVE' || status === 'SUSPENDED' || status === 'CLOSED' ? dbToUi(status) : status) as UiStatus;
  return STATUS[key];
}

export function relMinutes(m: number): string {
  if (m < 1) return 'just now';
  if (m < 60) return `${Math.floor(m)}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ${Math.floor(m % 60)}m ago`;
  return `${Math.floor(m / 1440)}d ago`;
}

export function relTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  return relMinutes((Date.now() - t) / 60_000);
}

export function fdate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fdt(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

export function ftime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function mapsUrl(placeId: string, cid?: string | null): string {
  if (cid) return `https://maps.google.com/?cid=${encodeURIComponent(cid)}`;
  return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;
}

export function locationLine(l: Pick<Listing, 'address' | 'city' | 'category'>): string {
  const address = l.address?.trim() ?? '';
  const city = l.city?.trim() ?? '';
  // Don't repeat the city when the address already contains it ("…, 75009 Paris, France").
  const parts = [address, city && !address.toLowerCase().includes(city.toLowerCase()) ? city : ''].filter(Boolean);
  return parts.join(', ') || l.category || '';
}

/** SVG path helpers for sparklines / trend charts. */
export function linePath(pts: number[], w: number, h: number, pad = 5): { d: string; area: string; lx: number; ly: number } {
  if (pts.length === 0) return { d: '', area: '', lx: 0, ly: h };
  if (pts.length === 1) pts = [pts[0], pts[0]];
  const mx = Math.max(...pts);
  const mn = Math.min(...pts);
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const X = (i: number) => r1((i / (pts.length - 1)) * w);
  const Y = (v: number) => r1(h - pad - ((v - mn) / (mx - mn || 1)) * (h - 2 * pad));
  let d = `M${X(0)} ${Y(pts[0])}`;
  for (let i = 1; i < pts.length; i++) d += ` L${X(i)} ${Y(pts[i])}`;
  return { d, area: `${d} L${w} ${h} L0 ${h} Z`, lx: X(pts.length - 1), ly: Y(pts[pts.length - 1]) };
}

/** Next run of a simple daily/hourly cron expression ("m h * * *"). Returns null for anything fancier. */
export function nextCronRun(expr: string, from = new Date()): Date | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minS, hourS, dom, mon, dow] = parts;
  if (dom !== '*' || mon !== '*' || dow !== '*') return null;
  const minute = Number(minS);
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;

  if (hourS === '*') {
    const d = new Date(from);
    d.setUTCSeconds(0, 0);
    d.setUTCMinutes(minute);
    if (d <= from) d.setUTCHours(d.getUTCHours() + 1);
    return d;
  }
  const hours = hourS.split(',').map(Number);
  if (hours.some((h) => !Number.isInteger(h) || h < 0 || h > 23)) return null;
  const candidates: Date[] = [];
  for (const dayOffset of [0, 1]) {
    for (const h of hours) {
      const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + dayOffset, h, minute, 0, 0));
      if (d > from) candidates.push(d);
    }
  }
  candidates.sort((a, b) => a.getTime() - b.getTime());
  return candidates[0] ?? null;
}

export function countdown(to: Date | null): { long: string; short: string; pct: string } {
  if (!to) return { long: '—', short: '—', pct: '0%' };
  const df = Math.max(0, to.getTime() - Date.now());
  const h = Math.floor(df / 36e5);
  const m = Math.floor((df % 36e5) / 6e4);
  return { long: `${h}h ${m}m`, short: `in ${h}h ${m}m`, pct: `${(100 - (df / 864e5) * 100).toFixed(1)}%` };
}

export function cronToLabel(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [m, h] = parts;
  if (h === '*') return `every hour at :${m.padStart(2, '0')}`;
  const hours = h.split(',').map((x) => `${x.padStart(2, '0')}:${m.padStart(2, '0')}`);
  return hours.length === 1 ? `daily at ${hours[0]} UTC` : `daily at ${hours.join(', ')} UTC`;
}

export function humanMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  return `${m}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function pct(n: number, total: number, digits = 1): string {
  return total ? `${((n / total) * 100).toFixed(digits)}%` : '0%';
}

export function downloadText(filename: string, content: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toCsv(rows: Array<Record<string, unknown>>, columns: Array<{ key: string; label: string }>): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => esc(c.label)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => esc(r[c.key])).join(','));
  return `﻿${lines.join('\r\n')}`;
}

/** Minimal RFC-4180 CSV parser (handles quotes, commas, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',' || ch === '\t' || ch === ';') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}
