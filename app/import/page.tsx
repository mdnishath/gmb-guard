'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, errorMessage } from '@/components/app-context';
import { extractPlaceId } from '@/components/listing-modal';
import { IC, Icon } from '@/components/ui';
import { api, type Confidence, type ListingInput, type PlaceCandidate, type ResolveResult } from '@/lib/client/api';
import { downloadText, parseCsv } from '@/lib/client/format';
import { bestCategory, cityFromAddress } from '@/lib/derive';

type Target = '' | 'name' | 'placeId' | 'phone' | 'address' | 'city' | 'website' | 'category' | 'tag' | 'cid' | 'accountEmail' | 'accountPassword' | 'totpSecret';
const TARGETS: Array<[Target, string]> = [
  ['', 'Ignore column'],
  ['name', 'Business name'],
  ['placeId', 'Place ID / Maps link'],
  ['phone', 'Phone'],
  ['address', 'Address'],
  ['city', 'City / area'],
  ['website', 'Website'],
  ['category', 'Category'],
  ['tag', 'Tag'],
  ['cid', 'CID'],
  ['accountEmail', 'Google account email'],
  ['accountPassword', 'Account password (encrypted)'],
  ['totpSecret', '2FA / TOTP secret (encrypted)'],
];

function guessTarget(header: string): Target {
  const h = header.toLowerCase().replace(/[^a-z]/g, '');
  if (/totp|2fa|twofa|otp|authenticator|secret/.test(h)) return 'totpSecret';
  if (/password|passw|pwd|motdepasse|mdp/.test(h)) return 'accountPassword';
  if (/email|mail|login|account/.test(h)) return 'accountEmail';
  if (/placeid|maps|gmb|gbp|profile|listing(url|link)/.test(h)) return 'placeId';
  if (/^cid$|\bcid\b/.test(h)) return 'cid';
  if (/web|site|domain/.test(h)) return 'website';
  if (/url|link/.test(h)) return 'placeId';
  if (/phone|tel|mobile|numero|number/.test(h)) return 'phone';
  if (/name|business|title|nom|company|entreprise/.test(h)) return 'name';
  if (/address|adresse|adress|street|rue/.test(h)) return 'address';
  if (/city|ville|town|location|area|zone|region/.test(h)) return 'city';
  if (/category|categorie|type|industry|service$/.test(h)) return 'category';
  if (/tag|label|group|client/.test(h)) return 'tag';
  return '';
}

const TEMPLATE =
  '﻿Business name,Phone,Address,City,Google Maps link,Website,Category,Tag\r\n' +
  'Atelier Technique Elect,01 89 52 11 25,"5 Rue de Turenne, 75004 Paris, France",Paris,https://maps.app.goo.gl/UrWXL3LTxiCiJcqy7,,Electrician,Client A\r\n';

interface PreparedRow {
  row: number;
  name: string;
  phone: string;
  address: string;
  city: string;
  website: string;
  category: string;
  tag: string;
  cid: string;
  accountEmail: string;
  accountPassword: string;
  totpSecret: string;
  /** Place ID given directly (or extracted from a URL that contains one). */
  givenPlaceId: string;
  /** A Maps link that still needs resolving. */
  mapsUrl: string;
}

interface MatchState {
  result: ResolveResult | null;
  /** Chosen Place ID ('' = skip). */
  choice: string;
  manual: string;
  error: string | null;
}

const CONF: Record<Confidence, { l: string; c: string; bg: string; bd: string }> = {
  exact: { l: 'Exact', c: 'var(--ok)', bg: 'var(--okBg)', bd: 'var(--okBd)' },
  high: { l: 'High', c: 'var(--ok)', bg: 'var(--okBg)', bd: 'var(--okBd)' },
  medium: { l: 'Review', c: 'var(--warn)', bg: 'var(--warnBg)', bd: 'var(--warnBd)' },
  low: { l: 'Low', c: 'var(--bad)', bg: 'var(--badBg)', bd: 'var(--badBd)' },
  none: { l: 'Not found', c: 'var(--na)', bg: 'var(--naBg)', bd: 'var(--naBd)' },
};

function ConfBadge({ c }: { c: Confidence }) {
  const m = CONF[c];
  return (
    <span className="pill" style={{ background: m.bg, borderColor: m.bd, color: m.c, fontSize: 11, padding: '2px 9px 2px 7px' }}>
      <span className="pill-dot" />
      <span>{m.l}</span>
    </span>
  );
}

async function readSpreadsheet(file: File): Promise<string[][]> {
  if (/\.(xlsx|xlsm|xls)$/i.test(file.name)) {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '' });
    return grid.map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c).trim()))).filter((r) => r.some((c) => c !== ''));
  }
  return parseCsv(await file.text());
}

export default function ImportPage() {
  const app = useApp();
  const [step, setStep] = useState(1);
  const [rows, setRows] = useState<string[][]>([]);
  const [fileName, setFileName] = useState('');
  const [map, setMap] = useState<Target[]>([]);
  const [checkNow, setCheckNow] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ imported: number; duplicates: number; invalid: number; changed: number; errors: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [paste, setPaste] = useState('');
  const [drag, setDrag] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);

  // matching
  const [matches, setMatches] = useState<Record<number, MatchState>>({});
  const [matching, setMatching] = useState(false);
  const [matchDone, setMatchDone] = useState(0);
  const abortRef = useRef(false);
  const [filter, setFilter] = useState<'all' | 'review' | 'none'>('all');
  /** URL-only lookup: expand Maps links and read the page, never call the Google API. */
  const [freeMode, setFreeMode] = useState(true);
  const [apiDisabled, setApiDisabled] = useState(false);

  useEffect(() => {
    api.settings
      .get()
      .then((s) => {
        if (s.google.disabled) {
          setApiDisabled(true);
          setFreeMode(true);
          setCheckNow(false);
        }
      })
      .catch(() => {});
  }, []);

  const headers = rows[0] ?? [];
  const body = useMemo(() => rows.slice(1), [rows]);

  const loadGrid = (parsed: string[][], name: string) => {
    if (parsed.length < 2) {
      app.toast('Nothing to import', 'The file needs a header row and at least one data row.', { tone: 'warn' });
      return;
    }
    setRows(parsed);
    setFileName(name);
    setMap(parsed[0].map(guessTarget));
    setMatches({});
    setStep(2);
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setLoadingFile(true);
    try {
      loadGrid(await readSpreadsheet(f), f.name);
    } catch (err) {
      app.toast('Could not read file', errorMessage(err), { tone: 'bad' });
    } finally {
      setLoadingFile(false);
    }
  };

  // --- prepared rows -----------------------------------------------------------
  const prepared = useMemo<PreparedRow[]>(() => {
    const idx = (t: Target) => map.indexOf(t);
    return body.map((r, i) => {
      const get = (t: Target) => (idx(t) >= 0 ? (r[idx(t)] ?? '').trim() : '');
      const raw = get('placeId');
      const ex = extractPlaceId(raw);
      return {
        row: i + 2,
        name: get('name'),
        phone: get('phone'),
        address: get('address'),
        city: get('city'),
        website: get('website'),
        category: get('category'),
        tag: get('tag'),
        accountEmail: get('accountEmail'),
        accountPassword: get('accountPassword'),
        totpSecret: get('totpSecret'),
        cid: (get('cid') || ex.cid || '').replace(/\D/g, ''),
        // A real Place ID skips the lookup; a bare CID still goes through the link step so we can read name/address.
        givenPlaceId: ex.placeId && !ex.placeId.startsWith('cid:') ? ex.placeId : '',
        mapsUrl: /^https?:\/\//i.test(raw) && !(ex.placeId && !ex.placeId.startsWith('cid:')) ? raw : ex.placeId?.startsWith('cid:') ? `https://maps.google.com/?cid=${ex.cid}` : '',
      };
    });
  }, [body, map]);

  const needsMatch = useMemo(() => prepared.filter((p) => p.name && !p.givenPlaceId), [prepared]);

  // --- matching ----------------------------------------------------------------
  const runMatch = async () => {
    abortRef.current = false;
    setMatching(true);
    setMatchDone(0);
    const todo = needsMatch.filter((p) => !matches[p.row]?.result);
    const chunks: PreparedRow[][] = [];
    for (let i = 0; i < todo.length; i += 10) chunks.push(todo.slice(i, i + 10));
    let done = 0;
    const worker = async () => {
      while (chunks.length && !abortRef.current) {
        const chunk = chunks.shift()!;
        try {
          const r = await api.listings.resolve(
            chunk.map((p) => ({ name: p.name, phone: p.phone || undefined, address: p.address || undefined, city: p.city || undefined, website: p.website || undefined, mapsUrl: p.mapsUrl || undefined })),
            freeMode ? 'free' : 'auto',
          );
          setMatches((m) => {
            const next = { ...m };
            chunk.forEach((p, i) => {
              const res = r.results[i];
              const auto = res && (res.confidence === 'exact' || res.confidence === 'high' || res.confidence === 'medium') && res.best ? res.best.placeId : '';
              next[p.row] = { result: res ?? null, choice: auto, manual: '', error: res?.error ?? null };
            });
            return next;
          });
        } catch (err) {
          const msg = errorMessage(err);
          setMatches((m) => {
            const next = { ...m };
            chunk.forEach((p) => (next[p.row] = { result: null, choice: '', manual: '', error: msg }));
            return next;
          });
          if (/denied|API key/i.test(msg)) abortRef.current = true;
        }
        done += chunk.length;
        setMatchDone(done);
      }
    };
    await Promise.all([worker(), worker()]);
    setMatching(false);
  };

  useEffect(() => {
    if (step === 3 && !matching && needsMatch.some((p) => !matches[p.row])) void runMatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const matchSummary = useMemo(() => {
    const s = { exact: 0, high: 0, medium: 0, low: 0, none: 0, pending: 0 };
    for (const p of needsMatch) {
      const m = matches[p.row];
      if (!m || !m.result) s.pending++;
      else s[m.result.confidence]++;
    }
    return s;
  }, [needsMatch, matches]);

  const [manualBusy, setManualBusy] = useState<number | null>(null);

  /** Resolve a Maps URL pasted into the manual box for one row. */
  const resolveManual = async (p: PreparedRow) => {
    const url = matches[p.row]?.manual?.trim();
    if (!url || !/^https?:/i.test(url)) return;
    setManualBusy(p.row);
    try {
      const r = await api.listings.resolve([{ name: p.name, phone: p.phone || undefined, address: p.address || undefined, city: p.city || undefined, mapsUrl: url }], freeMode ? 'free' : 'auto');
      const res = r.results[0];
      setMatches((x) => ({
        ...x,
        [p.row]: {
          result: res ?? x[p.row]?.result ?? null,
          choice: res?.best ? res.best.placeId : '__manual__',
          manual: res?.best ? '' : url,
          error: res?.error ?? null,
        },
      }));
      if (!res?.best) app.toast('Still no match', res?.error ?? 'Could not read a Place ID from that link.', { tone: 'warn' });
    } catch (err) {
      app.toast('Resolve failed', errorMessage(err), { tone: 'bad' });
    } finally {
      setManualBusy(null);
    }
  };

  const chosenPlaceId = (p: PreparedRow): string => {
    if (p.givenPlaceId) return p.givenPlaceId;
    const m = matches[p.row];
    if (!m) return '';
    const manual = extractPlaceId(m.manual).placeId;
    return m.choice === '__manual__' ? manual ?? '' : m.choice;
  };

  // --- validation --------------------------------------------------------------
  const validated = useMemo(() => {
    const valid: Array<ListingInput & { row: number }> = [];
    const skipped: Array<{ row: number; name: string; reason: string }> = [];
    const seen = new Set<string>();
    let dups = 0;
    for (const p of prepared) {
      if (!p.name) {
        skipped.push({ row: p.row, name: '(no name)', reason: 'Business name is empty' });
        continue;
      }
      const placeId = chosenPlaceId(p);
      if (!placeId) {
        skipped.push({ row: p.row, name: p.name, reason: p.givenPlaceId || matches[p.row]?.result ? 'No Google match chosen' : 'Not matched yet' });
        continue;
      }
      if (seen.has(placeId)) {
        dups++;
        continue;
      }
      seen.add(placeId);
      const cand = matches[p.row]?.result?.candidates.find((c) => c.placeId === placeId);
      valid.push({
        row: p.row,
        name: p.name,
        placeId,
        cid: p.cid || matches[p.row]?.result?.mapsLink?.cid || null,
        address: p.address || cand?.address || null,
        city: p.city || cityFromAddress(p.address || cand?.address) || null,
        category: p.category || bestCategory(cand?.types, p.name) || null,
        phone: p.phone || cand?.phone || null,
        website: p.website || cand?.website || null,
        sourceUrl: p.mapsUrl || matches[p.row]?.result?.mapsLink?.finalUrl || null,
        tag: p.tag || null,
        accountEmail: p.accountEmail || null,
        accountPassword: p.accountPassword || null,
        totpSecret: p.totpSecret || null,
      });
    }
    return { valid, skipped, dups };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepared, matches]);

  const run = async () => {
    setRunning(true);
    setStep(5);
    try {
      const payload = validated.valid.map(({ row: _row, ...rest }) => rest);
      const r = await api.listings.import(payload, checkNow);
      setResult({ imported: r.imported, duplicates: r.duplicates + validated.dups, invalid: r.invalid.length + validated.skipped.length, changed: r.check?.changed ?? 0, errors: r.check?.errors ?? 0 });
      app.bumpRefresh();
      app.toast(`${r.imported} listings imported`, r.check ? `${r.check.checked} checked · ${r.check.changed} not live` : 'Checks will run on the next schedule.');
    } catch (err) {
      app.toast('Import failed', errorMessage(err), { tone: 'bad' });
      setStep(4);
    } finally {
      setRunning(false);
    }
  };

  const reset = () => {
    abortRef.current = true;
    setStep(1);
    setRows([]);
    setMap([]);
    setMatches({});
    setResult(null);
    setPaste('');
    setFileName('');
  };

  const steps = ['Upload', 'Map columns', 'Match on Google', 'Review', 'Import'];
  const previewCols = map.map((t, i) => ({ t, i })).filter((c) => c.t);
  const canContinueMap = map.includes('name') && (map.includes('placeId') || map.includes('phone') || map.includes('address') || map.includes('city'));

  const visibleMatchRows = needsMatch.filter((p) => {
    const m = matches[p.row];
    if (filter === 'all') return true;
    if (!m?.result) return filter === 'none';
    if (filter === 'review') return m.result.confidence === 'medium' || m.result.confidence === 'low';
    return m.result.confidence === 'none' || !m.choice;
  });

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <Link href="/businesses" className="link-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--muted)', marginBottom: 14 }}>
        <Icon d={IC.back} size={13} stroke={2.4} />
        <span>Back to businesses</span>
      </Link>
      <h1 className="h1">Import businesses</h1>
      <p className="sub">Upload an Excel or CSV file. We find each business on Google automatically — a name plus a phone, address or Maps link is enough.</p>

      <div style={{ display: 'flex', alignItems: 'center', margin: '20px 0 18px' }}>
        {steps.map((l, i) => {
          const n = i + 1;
          const done = step > n;
          const act = step === n;
          return (
            <div key={l} style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
              <span style={{ width: 26, height: 26, borderRadius: '50%', background: done || act ? 'var(--accent)' : 'var(--surface2)', color: done || act ? 'var(--accentFg)' : 'var(--faint)', fontSize: 12, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
                {done ? '✓' : n}
              </span>
              <span style={{ fontSize: 12.5, fontWeight: act ? 800 : 600, color: act ? 'var(--text)' : 'var(--muted)', margin: '0 10px 0 8px', whiteSpace: 'nowrap' }}>{l}</span>
              {i < steps.length - 1 ? <span style={{ flex: 1, height: 2, background: done ? 'var(--accent)' : 'var(--border)', borderRadius: 2, minWidth: 12 }} /> : null}
            </div>
          );
        })}
      </div>

      {/* ---------------------------------------------------------------- 1 */}
      {step === 1 ? (
        <div className="card card-pad" style={{ padding: 20 }}>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              void onFile(e.dataTransfer.files[0]);
            }}
            style={{ border: `1.5px dashed ${drag ? 'var(--accent)' : 'var(--border2)'}`, borderRadius: 12, padding: '44px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', background: drag ? 'var(--accentSoft)' : 'var(--well)' }}
          >
            <span style={{ width: 46, height: 46, borderRadius: 13, background: 'var(--accentSoft)', color: 'var(--accentInk)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              {loadingFile ? <Icon d={IC.spinner} size={20} spin /> : <Icon d={IC.upload} size={20} />}
            </span>
            <div style={{ fontSize: 14.5, fontWeight: 800, marginTop: 12 }}>Drag and drop your .xlsx or .csv here</div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>Up to 5,000 rows · we auto-detect your columns</div>
            <input ref={fileRef} type="file" accept=".csv,.txt,.xlsx,.xls,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
            <button onClick={() => fileRef.current?.click()} className="btn btn-primary" style={{ marginTop: 14, padding: '8px 15px' }}>
              Browse files
            </button>
          </div>
          <div style={{ marginTop: 14 }}>
            <label className="label">Or paste rows (name, phone, address, maps link…)</label>
            <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'Business name,Phone,Address,Maps link\nAtelier Technique Elect,01 89 52 11 25,"5 Rue de Turenne, 75004 Paris",https://maps.app.goo.gl/UrWXL3LTxiCiJcqy7'} className="input mono" style={{ minHeight: 110, fontSize: 12, marginTop: 6 }} />
            <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => loadGrid(parseCsv(paste), 'pasted rows')} disabled={!paste.trim()} className="btn btn-soft btn-sm">
                Use pasted rows
              </button>
              <button onClick={() => downloadText('gmb-import-template.csv', TEMPLATE)} className="link-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <Icon d={IC.download} size={12} stroke={2.2} />
                <span>Download sample template</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- 2 */}
      {step === 2 ? (
        <div className="card card-pad" style={{ padding: 20 }}>
          <div className="card-title">Map your columns</div>
          <div className="card-sub">
            {fileName} · {body.length} rows · we matched {map.filter(Boolean).length} of {headers.length} columns automatically — override anything that looks wrong. Account password and 2FA secret are stored encrypted.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
            {headers.map((h, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 10, flexWrap: 'wrap' }}>
                <span className="mono ell" style={{ fontSize: 12.5, fontWeight: 700, flex: 1, minWidth: 130 }}>
                  {h || `(column ${i + 1})`}
                </span>
                <span className="ell" style={{ fontSize: 11.5, color: 'var(--faint)', flex: 1, minWidth: 120 }}>
                  {body[0]?.[i] ?? ''}
                </span>
                <Icon d={IC.arrow} size={13} stroke={2.2} color="var(--faint)" />
                <select value={map[i] ?? ''} onChange={(e) => setMap((m) => m.map((x, j) => (j === i ? (e.target.value as Target) : x)))} aria-label="Target field" className="select" style={{ minWidth: 170, color: 'var(--text)' }}>
                  {TARGETS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                {guessTarget(h) && guessTarget(h) === map[i] ? <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--ok)', background: 'var(--okBg)', border: '1px solid var(--okBd)', borderRadius: 5, padding: '2px 7px', textTransform: 'uppercase', letterSpacing: 0.4 }}>Auto</span> : null}
              </div>
            ))}
          </div>
          <div className="label" style={{ marginTop: 18 }}>Preview · first 5 rows</div>
          <div style={{ overflowX: 'auto', marginTop: 8, border: '1px solid var(--border)', borderRadius: 10 }}>
            <div style={{ minWidth: 560 }}>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, previewCols.length)}, minmax(120px,1fr))`, gap: 10, padding: '8px 12px', background: 'var(--well)', borderBottom: '1px solid var(--border)' }} className="th">
                {previewCols.map((c) => (
                  <span key={c.i}>{TARGETS.find((t) => t[0] === c.t)?.[1]}</span>
                ))}
              </div>
              {body.slice(0, 5).map((r, ri) => (
                <div key={ri} style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, previewCols.length)}, minmax(120px,1fr))`, gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                  {previewCols.map((c) => (
                    <span key={c.i} className="ell" style={{ color: c.t === 'name' ? 'var(--text)' : 'var(--muted)', fontWeight: c.t === 'name' ? 600 : 400 }}>
                      {r[c.i]}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, padding: '11px 12px', border: `1px solid ${freeMode ? 'var(--okBd)' : 'var(--border)'}`, borderRadius: 10, background: freeMode ? 'var(--okBg)' : 'var(--well)' }}>
            <input type="checkbox" id="freemode" checked={freeMode} disabled={apiDisabled} onChange={(e) => setFreeMode(e.target.checked)} />
            <label htmlFor="freemode" style={{ fontSize: 12.5, fontWeight: 600, flex: 1 }}>
              URL-only lookup — read each Maps link directly, <b>no Google API calls</b>. Rows without a link stay unmatched (you can pick them up later with API mode).
              {apiDisabled ? <span style={{ color: 'var(--bad)', fontWeight: 800 }}> Google API is switched off in Settings, so this is the only mode.</span> : null}
            </label>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button onClick={reset} className="btn btn-outline" style={{ fontSize: 13, padding: '9px 14px' }}>Back</button>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {needsMatch.length} of {prepared.filter((p) => p.name).length} rows need a lookup · {freeMode ? 'URL-only mode' : 'URL + Google API'}
            </div>
            <button onClick={() => setStep(needsMatch.length ? 3 : 4)} disabled={!canContinueMap} className="btn btn-primary" style={{ fontSize: 13, padding: '9px 16px' }}>
              {needsMatch.length ? 'Find on Google' : 'Continue to review'}
            </button>
          </div>
          {!canContinueMap ? <div className="err" style={{ marginTop: 8 }}>Map a Business name plus at least one of: Maps link, Phone, Address or City.</div> : null}
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- 3 */}
      {step === 3 ? (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              {matching ? <Icon d={IC.spinner} size={17} stroke={2.4} spin color="var(--accentInk)" /> : <Icon d={IC.check} size={17} stroke={2.6} color="var(--ok)" />}
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>
                  {matching ? (freeMode ? 'Reading Maps links…' : 'Finding businesses on Google…') : freeMode ? 'Link lookup complete (no API used)' : 'Google lookup complete'}{' '}
                  <span className="tnum" style={{ color: 'var(--muted)', fontWeight: 600 }}>
                    {Math.min(matchDone, needsMatch.length)} / {needsMatch.length}
                  </span>
                </div>
                <div className="progress" style={{ height: 6, marginTop: 9 }}>
                  <i style={{ width: `${needsMatch.length ? Math.round((Math.min(matchDone, needsMatch.length) / needsMatch.length) * 100) : 100}%` }} />
                </div>
              </div>
              {matching ? (
                <button onClick={() => (abortRef.current = true)} className="btn btn-outline btn-sm">Stop</button>
              ) : matchSummary.pending ? (
                <button onClick={() => void runMatch()} className="btn btn-soft btn-sm">Resume</button>
              ) : freeMode && matchSummary.none + matchSummary.low > 0 ? (
                <button
                  onClick={() => {
                    setFreeMode(false);
                    setMatches((m) => {
                      const next = { ...m };
                      for (const p of needsMatch) {
                        const r = next[p.row]?.result;
                        if (!r || r.confidence === 'none' || r.confidence === 'low') delete next[p.row];
                      }
                      return next;
                    });
                    setTimeout(() => void runMatch(), 0);
                  }}
                  className="btn btn-soft btn-sm"
                  title="Retry only the unmatched rows using the Google API"
                >
                  Retry {matchSummary.none + matchSummary.low} unmatched with API
                </button>
              ) : null}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', fontSize: 12 }}>
              <span className="chip active">Exact · {matchSummary.exact}</span>
              <span className="chip">High · {matchSummary.high}</span>
              <button onClick={() => setFilter(filter === 'review' ? 'all' : 'review')} className={`chip ${filter === 'review' ? 'active' : ''}`}>Needs review · {matchSummary.medium + matchSummary.low}</button>
              <button onClick={() => setFilter(filter === 'none' ? 'all' : 'none')} className={`chip ${filter === 'none' ? 'active' : ''}`}>Not found · {matchSummary.none}</button>
              {matchSummary.pending ? <span className="chip">Pending · {matchSummary.pending}</span> : null}
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 820 }}>
              <div className="th" style={{ display: 'grid', gridTemplateColumns: '1.6fr 2fr 110px 220px', gap: 12, padding: '9px 20px', background: 'var(--well)', borderBottom: '1px solid var(--border)' }}>
                <span>Your row</span>
                <span>Google match</span>
                <span>Confidence</span>
                <span>Use</span>
              </div>
              {visibleMatchRows.slice(0, 500).map((p) => {
                const m = matches[p.row];
                const res = m?.result ?? null;
                const chosen = res?.candidates.find((c) => c.placeId === m?.choice) ?? null;
                return (
                  <div key={p.row} style={{ display: 'grid', gridTemplateColumns: '1.6fr 2fr 110px 220px', gap: 12, padding: '10px 20px', borderBottom: '1px solid var(--border)', alignItems: 'start', background: m && res && !m.choice ? 'var(--warnBg)' : 'transparent' }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="ell" style={{ fontSize: 13, fontWeight: 700 }}>
                        <span style={{ color: 'var(--faint)', fontWeight: 600 }}>#{p.row} </span>
                        {p.name}
                      </div>
                      <div className="ell" style={{ fontSize: 11.5, color: 'var(--faint)' }}>{[p.phone, p.address || p.city].filter(Boolean).join(' · ')}</div>
                      {p.mapsUrl ? (
                        <div className="ell" style={{ fontSize: 10.5, color: res?.mapsLink && (res.mapsLink.cid || res.mapsLink.placeId) ? 'var(--ok)' : res ? 'var(--warn)' : 'var(--faint)' }} title={res?.mapsLink?.finalUrl ?? p.mapsUrl}>
                          {!res ? (
                            <span className="mono">{p.mapsUrl}</span>
                          ) : res.mapsLink && (res.mapsLink.cid || res.mapsLink.placeId) ? (
                            <>link ✓ {res.mapsLink.name ? `“${res.mapsLink.name}”` : ''}{res.mapsLink.placeId ? ' · place id' : ` · cid ${res.mapsLink.cid} (Place ID fills in on first check)`}</>
                          ) : (
                            <>link ✗ {res.mapsLink?.finalUrl ? 'expanded but no id in URL' : 'could not be expanded'}</>
                          )}
                        </div>
                      ) : null}
                      {res?.error && res.candidates.length ? (
                        <div className="ell" style={{ fontSize: 10.5, color: 'var(--warn)' }} title={res.error}>
                          {res.error}
                        </div>
                      ) : null}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      {!m ? (
                        <span style={{ fontSize: 12, color: 'var(--faint)' }}>Waiting…</span>
                      ) : m.error && !res ? (
                        <span className="err" style={{ marginTop: 0 }}>{m.error}</span>
                      ) : chosen ? (
                        <>
                          <div className="ell" style={{ fontSize: 13, fontWeight: 600 }}>{chosen.name}</div>
                          <div className="ell" style={{ fontSize: 11.5, color: 'var(--muted)' }}>{chosen.address ?? '—'}</div>
                          <div style={{ fontSize: 11, color: 'var(--faint)', display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                            {chosen.phone ? <span>{chosen.phone}</span> : null}
                            {chosen.signals.map((s) => (
                              <span key={s} style={{ background: 'var(--surface2)', borderRadius: 5, padding: '0 6px', fontWeight: 700 }}>
                                {s}
                              </span>
                            ))}
                            {chosen.businessStatus && chosen.businessStatus !== 'OPERATIONAL' ? <span style={{ color: 'var(--bad)', fontWeight: 700 }}>{chosen.businessStatus}</span> : null}
                          </div>
                        </>
                      ) : res?.candidates.length ? (
                        <span style={{ fontSize: 12, color: 'var(--warn)', fontWeight: 600 }}>Pick a match on the right, or skip.</span>
                      ) : (
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                          <div>Nothing found on Google. Paste a Place ID or Maps URL on the right.</div>
                          {res?.mapsLink ? (
                            <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 2 }}>
                              Maps link → {res.mapsLink.name ? `“${res.mapsLink.name}”` : 'no name'}
                              {res.mapsLink.lat !== null ? ` · ${res.mapsLink.lat.toFixed(4)},${res.mapsLink.lng?.toFixed(4)}` : ' · no location'}
                              {res.mapsLink.cid ? ` · cid ${res.mapsLink.cid}` : ''}
                              {res.mapsLink.placeId ? ` · place id ${res.mapsLink.placeId}` : ''}
                              {!res.mapsLink.finalUrl ? ' · link could not be expanded' : ''}
                            </div>
                          ) : null}
                          {res?.queries?.length ? <div style={{ fontSize: 11, color: 'var(--faint)' }}>Searched: {res.queries.map((q) => `“${q}”`).join(', ')}</div> : null}
                          {res?.error ? <div className="err" style={{ marginTop: 3 }}>{res.error.slice(0, 220)}</div> : null}
                        </div>
                      )}
                    </div>
                    <div>{res ? <ConfBadge c={m?.choice && res.confidence !== 'exact' && res.confidence !== 'high' ? (chosen ? 'medium' : res.confidence) : res.confidence} /> : null}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {res ? (
                        <select
                          value={m?.choice ?? ''}
                          onChange={(e) => setMatches((x) => ({ ...x, [p.row]: { ...x[p.row], choice: e.target.value } }))}
                          className="select"
                          style={{ fontSize: 12, color: 'var(--text)', width: '100%' }}
                          aria-label="Choose match"
                        >
                          <option value="">Skip this row</option>
                          {res.candidates.map((c: PlaceCandidate) => (
                            <option key={c.placeId} value={c.placeId}>
                              {c.name} · {c.address ?? ''} ({c.score})
                            </option>
                          ))}
                          <option value="__manual__">Enter Place ID / URL…</option>
                        </select>
                      ) : null}
                      {m?.choice === '__manual__' ? (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <input
                            value={m.manual}
                            onChange={(e) => setMatches((x) => ({ ...x, [p.row]: { ...x[p.row], manual: e.target.value } }))}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void resolveManual(p);
                            }}
                            placeholder="ChIJ… or any Google Maps URL"
                            className={`input mono ${m.manual && !extractPlaceId(m.manual).placeId && !/^https?:/i.test(m.manual) ? 'invalid' : ''}`}
                            style={{ fontSize: 11.5, padding: '6px 9px' }}
                          />
                          {/^https?:/i.test(m.manual) && !extractPlaceId(m.manual).placeId ? (
                            <button onClick={() => void resolveManual(p)} disabled={manualBusy === p.row} className="btn btn-soft btn-sm" style={{ whiteSpace: 'nowrap', padding: '6px 9px' }}>
                              {manualBusy === p.row ? <Icon d={IC.spinner} size={11} stroke={3} spin /> : 'Resolve'}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              {visibleMatchRows.length === 0 ? <div style={{ padding: 24, textAlign: 'center', fontSize: 12.5, color: 'var(--muted)' }}>Nothing to show for this filter.</div> : null}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 20px', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button
              onClick={() => {
                abortRef.current = true;
                setStep(2);
              }}
              className="btn btn-outline"
              style={{ fontSize: 13, padding: '9px 14px' }}
            >
              Back
            </button>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {validated.valid.length} ready · {validated.skipped.length} will be skipped
            </div>
            <button onClick={() => setStep(4)} disabled={matching} className="btn btn-primary" style={{ fontSize: 13, padding: '9px 16px' }}>
              Continue to review
            </button>
          </div>
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- 4 */}
      {step === 4 ? (
        <div className="card card-pad" style={{ padding: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10 }}>
            <div className="stat-box" style={{ borderColor: 'var(--okBd)', background: 'var(--okBg)' }}><div className="tnum" style={{ fontSize: 23, fontWeight: 800, color: 'var(--ok)' }}>{validated.valid.length}</div><div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ok)' }}>Ready to import</div></div>
            <div className="stat-box" style={{ borderColor: 'var(--warnBd)', background: 'var(--warnBg)' }}><div className="tnum" style={{ fontSize: 23, fontWeight: 800, color: 'var(--warn)' }}>{validated.dups}</div><div style={{ fontSize: 12, fontWeight: 700, color: 'var(--warn)' }}>Duplicates in file · skipped</div></div>
            <div className="stat-box" style={{ borderColor: 'var(--badBd)', background: 'var(--badBg)' }}><div className="tnum" style={{ fontSize: 23, fontWeight: 800, color: 'var(--bad)' }}>{validated.skipped.length}</div><div style={{ fontSize: 12, fontWeight: 700, color: 'var(--bad)' }}>Without a match · skipped</div></div>
          </div>

          <div style={{ fontSize: 13, fontWeight: 700, marginTop: 18 }}>What will be imported</div>
          <div style={{ overflowX: 'auto', marginTop: 8, border: '1px solid var(--border)', borderRadius: 10, maxHeight: 320, overflowY: 'auto' }}>
            <div style={{ minWidth: 640 }}>
              <div className="th" style={{ display: 'grid', gridTemplateColumns: '2fr 2.2fr 1.4fr 1fr', gap: 10, padding: '8px 12px', background: 'var(--well)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0 }}>
                <span>Business</span>
                <span>Place ID</span>
                <span>Phone</span>
                <span>City</span>
              </div>
              {validated.valid.slice(0, 300).map((v) => (
                <div key={v.row} style={{ display: 'grid', gridTemplateColumns: '2fr 2.2fr 1.4fr 1fr', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                  <span className="ell" style={{ fontWeight: 600 }}>{v.name}</span>
                  <span className="ell mono" style={{ color: 'var(--muted)', fontSize: 11 }}>{v.placeId}</span>
                  <span className="ell" style={{ color: 'var(--muted)' }}>{v.phone ?? ''}</span>
                  <span className="ell" style={{ color: 'var(--muted)' }}>{v.city ?? ''}</span>
                </div>
              ))}
            </div>
          </div>

          {validated.skipped.length ? (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, marginTop: 18 }}>Rows that will be skipped</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 9, maxHeight: 220, overflowY: 'auto' }}>
                {validated.skipped.slice(0, 100).map((er) => (
                  <div key={er.row} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 10, flexWrap: 'wrap' }}>
                    <span className="mono" style={{ fontSize: 11, fontWeight: 800, color: 'var(--faint)', width: 58 }}>Row {er.row}</span>
                    <div style={{ flex: 1, minWidth: 180 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700 }}>{er.name}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>{er.reason}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, padding: '11px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--well)' }}>
            <input type="checkbox" id="chk" checked={checkNow} disabled={apiDisabled} onChange={(e) => setCheckNow(e.target.checked)} />
            <label htmlFor="chk" style={{ fontSize: 12.5, fontWeight: 600, flex: 1 }}>
              Run the first Google status check right after import ({validated.valid.length} listings, roughly {Math.max(2, Math.ceil((validated.valid.length * 0.45) / 10) * 5)}s)
              {apiDisabled ? <span style={{ color: 'var(--bad)', fontWeight: 800 }}> — unavailable, Google API is switched off</span> : null}
            </label>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18 }}>
            <button onClick={() => setStep(needsMatch.length ? 3 : 2)} className="btn btn-outline" style={{ fontSize: 13, padding: '9px 14px' }}>Back</button>
            <button onClick={() => void run()} disabled={validated.valid.length === 0} className="btn btn-primary" style={{ fontSize: 13, padding: '9px 16px' }}>
              Import {validated.valid.length} listings
            </button>
          </div>
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- 5 */}
      {step === 5 ? (
        <div className="card card-pad" style={{ padding: 20 }}>
          {running || !result ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '36px 16px', textAlign: 'center' }}>
              <Icon d={IC.spinner} size={22} stroke={2.4} spin color="var(--accentInk)" />
              <div style={{ fontSize: 15, fontWeight: 800, marginTop: 14 }}>Importing your listings…</div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>{checkNow ? 'Saving rows and running the first Google check.' : 'Saving rows.'}</div>
              <div className="progress indet" style={{ width: 'min(360px,100%)', height: 7, marginTop: 16 }}><i /></div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 16px', textAlign: 'center' }}>
              <span style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--okBg)', color: 'var(--ok)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', animation: 'pop .5s ease' }}>
                <Icon d={IC.check} size={24} stroke={2.6} />
              </span>
              <div style={{ fontSize: 17, fontWeight: 800, marginTop: 14 }}>{result.imported} listings imported</div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>
                {result.duplicates} duplicates skipped · {result.invalid} rows skipped
                {checkNow ? ` · first check done: ${result.changed} not live${result.errors ? `, ${result.errors} check errors` : ''}` : ' · first check runs on the next schedule'}
              </div>
              <div style={{ display: 'flex', gap: 9, marginTop: 18, flexWrap: 'wrap', justifyContent: 'center' }}>
                <Link href="/businesses" className="btn btn-primary" style={{ textDecoration: 'none', fontSize: 13, padding: '9px 16px' }}>View businesses</Link>
                <button onClick={reset} className="btn btn-outline" style={{ fontSize: 13, padding: '9px 14px' }}>Import another file</button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
