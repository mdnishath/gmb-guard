'use client';

import { useState, type ChangeEvent } from 'react';
import { api, type Listing, type PlaceCandidate } from '@/lib/client/api';
import { statusMeta } from '@/lib/client/format';
import { bestCategory, cityFromAddress } from '@/lib/derive';
import { useApp, errorMessage } from './app-context';
import { Field, IC, Icon, Modal } from './ui';

const PLACE_ID_RE = /^(?:cid:\d{1,20}|[A-Za-z0-9_-]{10,})$/;
const MAX_CID = 18446744073709551615n;

/** Google CIDs are unsigned 64-bit integers (max 20 digits). */
export function isValidCid(value: string): boolean {
  if (!/^\d{1,20}$/.test(value)) return false;
  try {
    const n = BigInt(value);
    return n > 0n && n <= MAX_CID;
  } catch {
    return false;
  }
}

/**
 * Accepts a raw Place ID, "cid:<number>", a bare CID, or a Google Maps URL
 * containing place_id / cid / an FTID (0x…:0x…). A CID becomes the
 * "cid:<number>" identifier, which the first status check upgrades to a Place ID.
 */
export function extractPlaceId(input: string): { placeId?: string; cid?: string } {
  const s = input.trim();
  if (!s) return {};
  const pid = s.match(/[?&!](?:query_)?place_id[:=]([A-Za-z0-9_-]{10,})/) ?? s.match(/!(?:1|19)s(ChIJ[A-Za-z0-9_-]{10,})/);
  if (pid) return { placeId: pid[1] };
  const cidDirect = s.match(/^cid:(\d+)$/i);
  if (cidDirect) return isValidCid(cidDirect[1]) ? { placeId: `cid:${cidDirect[1]}`, cid: cidDirect[1] } : {};
  const cid = s.match(/[?&]cid=(\d+)/) || s.match(/^(\d{10,25})$/);
  if (cid) {
    const normalized = cid[1].replace(/^0+(?=\d)/, ''); // a CID never has leading zeros
    return isValidCid(normalized) ? { placeId: `cid:${normalized}`, cid: normalized } : {};
  }
  const ftid = s.match(/!1s0x[0-9a-f]+:0x([0-9a-f]+)/i);
  if (ftid) {
    const c = BigInt(`0x${ftid[1]}`).toString();
    return { placeId: `cid:${c}`, cid: c };
  }
  if (PLACE_ID_RE.test(s) && !/^https?:/i.test(s)) return { placeId: s };
  return {};
}

export function ListingModal({ mode, listing, onClose, onSaved }: { mode: 'add' | 'edit'; listing?: Listing; onClose: () => void; onSaved: (l: Listing) => void }) {
  const app = useApp();
  const [f, setF] = useState({
    name: listing?.name ?? '',
    placeId: listing?.placeId ?? '',
    cid: listing?.cid ?? '',
    address: listing?.address ?? '',
    city: listing?.city ?? '',
    category: listing?.category ?? '',
    phone: listing?.phone ?? '',
    website: listing?.website ?? '',
    tag: listing?.tag ?? '',
    accountEmail: listing?.accountEmail ?? '',
    accountPassword: '',
    totpSecret: '',
  });
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // Find on Google
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [cands, setCands] = useState<PlaceCandidate[] | null>(null);
  const [picked, setPicked] = useState<PlaceCandidate | null>(null);

  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const v = e.target.value;
    setF((x) => ({ ...x, [k]: v }));
    setErr((x) => ({ ...x, [k]: '' }));
    if (k === 'placeId') setPicked(null);
  };

  const onPlaceIdBlur = () => {
    const ex = extractPlaceId(f.placeId);
    if (ex.placeId) setF((x) => ({ ...x, placeId: ex.placeId!, cid: x.cid || ex.cid || x.cid }));
  };

  const search = async () => {
    const query = q.trim() || [f.name, f.address || f.city].filter(Boolean).join(', ');
    if (!query && !f.phone) {
      setErr((x) => ({ ...x, search: 'Type a business name (and city), a phone number, or paste a Maps link' }));
      return;
    }
    setSearching(true);
    setErr((x) => ({ ...x, search: '' }));
    try {
      const isUrl = /^https?:\/\//i.test(query);
      const looksPhone = /^[+\d][\d\s().-]{6,}$/.test(query);
      const row = {
        name: isUrl || looksPhone ? f.name || query : query,
        phone: looksPhone ? query : f.phone || undefined,
        mapsUrl: isUrl ? query : undefined,
        address: f.address || undefined,
        city: f.city || undefined,
        website: f.website || undefined,
      };
      // A Maps link is resolved without the Google API first; fall back to the API only if that fails.
      let r = await api.listings.resolve([row], isUrl ? 'free' : 'auto');
      if (isUrl && !r.results[0]?.best) r = await api.listings.resolve([row], 'auto');
      const res = r.results[0];
      setCands(res?.candidates ?? []);
      if (res?.best && (res.confidence === 'exact' || res.confidence === 'high')) pick(res.best);
      if (!res?.candidates.length) setErr((x) => ({ ...x, search: res?.error ? res.error : 'No match on Google. Try adding the city, or paste the Maps link.' }));
    } catch (e) {
      setErr((x) => ({ ...x, search: errorMessage(e) }));
    } finally {
      setSearching(false);
    }
  };

  const pick = (c: PlaceCandidate) => {
    setPicked(c);
    setF((x) => ({
      ...x,
      placeId: c.placeId,
      name: x.name || c.name,
      address: x.address || c.address || '',
      city: x.city || cityFromAddress(c.address) || '',
      category: x.category || bestCategory(c.types, x.name || c.name) || '',
      phone: x.phone || c.phone || '',
      website: x.website || c.website || '',
    }));
    setErr((x) => ({ ...x, placeId: '', search: '' }));
  };

  const save = async () => {
    const e: Record<string, string> = {};
    if (!f.name.trim()) e.name = 'Business name is required';
    if (mode === 'add' || f.placeId.trim() !== (listing?.placeId ?? '')) {
      if (!f.placeId.trim()) e.placeId = 'Find the business on Google above, or paste its Place ID';
      else if (!PLACE_ID_RE.test(f.placeId.trim())) e.placeId = /cid=|^cid:|^\d+$/.test(f.placeId.trim()) ? 'That CID is not valid (Google CIDs have at most 20 digits)' : 'Paste a valid Place ID (ChIJ…), a CID, or a Google Maps URL';
      else if (f.placeId.trim().startsWith('cid:') && !isValidCid(f.placeId.trim().slice(4))) e.placeId = 'That CID is not valid (Google CIDs have at most 20 digits)';
    }
    if (f.cid && !isValidCid(f.cid.trim())) e.cid = 'CID must be a number with at most 20 digits';
    const totp = f.totpSecret.replace(/[\s-]/g, '').replace(/=+$/g, '').toUpperCase();
    if (totp && !/^[A-Z2-7]{16,128}$/.test(totp)) e.totpSecret = 'Paste the secret exactly as Google shows it (letters and digits, spaces are fine)';
    if (f.accountEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.accountEmail.trim())) e.accountEmail = 'Enter a valid email';
    if (Object.keys(e).length) {
      setErr(e);
      return;
    }
    setBusy(true);
    try {
      const common = {
        name: f.name.trim(),
        cid: f.cid.trim() || null,
        address: f.address.trim() || null,
        city: f.city.trim() || null,
        category: f.category.trim() || null,
        phone: f.phone.trim() || null,
        website: f.website.trim() || null,
        sourceUrl: /^https?:\/\//i.test(q.trim()) ? q.trim() : listing?.sourceUrl ?? null,
        tag: f.tag.trim() || null,
        accountEmail: f.accountEmail.trim() || null,
        // Secrets: blank = leave unchanged when editing / not set when adding.
        ...(f.accountPassword ? { accountPassword: f.accountPassword } : {}),
        ...(totp ? { totpSecret: totp } : {}),
      };
      if (mode === 'add') {
        const r = await api.listings.create({ ...common, placeId: f.placeId.trim(), checkImmediately: true });
        const ic = r.initialCheck;
        if (ic?.error) app.toast('Business added', `"${r.listing.name}" saved, but the first check failed: ${ic.error}`, { tone: 'warn' });
        else app.toast('Business added', `"${r.listing.name}" is ${statusMeta(r.listing.currentStatus).l} on Google.`, { tone: r.listing.currentStatus === 'ACTIVE' ? 'ok' : 'bad' });
        onSaved(r.listing);
      } else if (listing) {
        const changedId = f.placeId.trim() && f.placeId.trim() !== listing.placeId;
        const r = await api.listings.update(listing.id, { ...common, ...(changedId ? { placeId: f.placeId.trim() } : {}) });
        if (changedId) {
          try {
            const c = await api.listings.checkOne(listing.id);
            app.toast('Place ID changed', `Re-checked: "${c.listing.name}" is ${statusMeta(c.listing.currentStatus).l}.${c.result?.detail ? ' ' + c.result.detail : ''}`, {
              tone: c.listing.currentStatus === 'ACTIVE' ? 'ok' : 'bad',
            });
            onSaved(c.listing);
            return;
          } catch {
            /* fall through to the normal toast */
          }
        }
        app.toast('Listing updated', `Changes to "${r.listing.name}" saved.`);
        onSaved(r.listing);
      }
    } catch (error) {
      const msg = errorMessage(error);
      if (/placeId/i.test(msg) && /exists/i.test(msg)) setErr({ placeId: 'This Place ID is already being monitored' });
      else app.toast(mode === 'add' ? 'Could not add business' : 'Could not save', msg, { tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={mode === 'add' ? 'Add business' : 'Edit business'} onClose={onClose} zIndex={75} width={520}>
      {mode === 'add' ? (
        <div style={{ marginTop: 16, padding: 12, border: '1px solid var(--accentBorder)', background: 'var(--accentSoft)', borderRadius: 11 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--accentInk)' }}>Find on Google</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>Business name + city, a phone number, or a Google Maps link. We fill in the Place ID for you.</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 9 }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void search();
              }}
              placeholder="Atelier Technique Elect, Paris  ·  01 89 52 11 25  ·  https://maps.app.goo.gl/…"
              aria-label="Search Google"
              className="input"
              autoFocus
            />
            <button onClick={() => void search()} disabled={searching} className="btn btn-primary" style={{ whiteSpace: 'nowrap', padding: '8px 13px' }}>
              {searching ? <Icon d={IC.spinner} size={12} stroke={3} spin color="#fff" /> : <Icon d={IC.search} size={13} stroke={2.2} />}
              Search
            </button>
          </div>
          {err.search ? <div className="err">{err.search}</div> : null}
          {cands && cands.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 9, maxHeight: 190, overflowY: 'auto' }}>
              {cands.map((c) => {
                const on = picked?.placeId === c.placeId;
                return (
                  <button key={c.placeId} onClick={() => pick(c)} style={{ textAlign: 'left', display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 10px', borderRadius: 9, background: on ? 'var(--surface)' : 'transparent', border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}` }}>
                    <span style={{ width: 16, height: 16, borderRadius: '50%', border: `1.5px solid ${on ? 'var(--accent)' : 'var(--border2)'}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto', marginTop: 2 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: on ? 'var(--accent)' : 'transparent' }} />
                    </span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span className="ell" style={{ display: 'block', fontSize: 12.5, fontWeight: 700 }}>{c.name}</span>
                      <span className="ell" style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)' }}>{c.address ?? '—'}{c.phone ? ` · ${c.phone}` : ''}</span>
                    </span>
                    <span className="tnum" style={{ fontSize: 11, fontWeight: 800, color: c.score >= 65 ? 'var(--ok)' : c.score >= 40 ? 'var(--warn)' : 'var(--faint)', flex: '0 0 auto' }}>
                      {c.score >= 65 ? 'High' : c.score >= 40 ? 'Medium' : 'Low'}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      <Field label="Business name *" error={err.name} style={{ marginTop: 14 }}>
        <input value={f.name} onChange={set('name')} placeholder="Bright Smile Dental Studio" aria-label="Business name" className={`input ${err.name ? 'invalid' : ''}`} />
      </Field>
      <Field label={mode === 'add' ? 'Google Place ID *' : 'Google Place ID'} error={err.placeId} style={{ marginTop: 13 }}>
        <input
          value={f.placeId}
          onChange={set('placeId')}
          onBlur={onPlaceIdBlur}
          placeholder="Filled by “Find on Google” — or paste ChIJ… / a Maps URL"
          aria-label="Place ID"
          className={`input mono ${err.placeId ? 'invalid' : ''}`}
          style={{ fontSize: 12 }}
        />
        {mode === 'edit' && f.placeId.trim() !== (listing?.placeId ?? '') ? (
          <div style={{ fontSize: 11.5, color: 'var(--warn)', marginTop: 5, fontWeight: 600 }}>
            Changing the Place ID points monitoring at a different Google listing. The stored CID and Maps link are cleared, and the status is re-checked against the new id.
          </div>
        ) : null}
        {picked ? (
          <div style={{ fontSize: 11.5, color: 'var(--ok)', marginTop: 5, fontWeight: 600 }}>
            ✓ Verified on Google: {picked.name}{picked.address ? ` · ${picked.address}` : ''}
          </div>
        ) : null}
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 13 }}>
        <Field label="Phone">
          <input value={f.phone} onChange={set('phone')} placeholder="01 89 52 11 25" aria-label="Phone" className="input" />
        </Field>
        <Field label="Website">
          <input value={f.website} onChange={set('website')} placeholder="https://example.com" aria-label="Website" className="input" />
        </Field>
      </div>
      <Field label="Address" style={{ marginTop: 13 }}>
        <input value={f.address} onChange={set('address')} placeholder="5 Rue de Turenne, 75004 Paris" aria-label="Address" className="input" />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 13 }}>
        <Field label="City / area">
          <input value={f.city} onChange={set('city')} placeholder="Paris" aria-label="City" className="input" />
        </Field>
        <Field label="Category">
          <input value={f.category} onChange={set('category')} placeholder="Electrician" aria-label="Category" className="input" />
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 13 }}>
        <Field label="CID (optional)" error={err.cid}>
          <input value={f.cid} onChange={set('cid')} placeholder="1234567890123456789" aria-label="CID" className={`input mono ${err.cid ? 'invalid' : ''}`} style={{ fontSize: 12 }} />
        </Field>
        <Field label="Tag">
          <input value={f.tag} onChange={set('tag')} placeholder="Priority" aria-label="Tag" className="input" list="gmb-tags" />
          <datalist id="gmb-tags">
            <option value="Priority" />
            <option value="New client" />
            <option value="Audit" />
          </datalist>
        </Field>
      </div>
      <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        <div style={{ fontSize: 12.5, fontWeight: 800 }}>Google account (optional)</div>
        <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 2 }}>Login for this profile. Password and 2FA secret are stored encrypted and only shown in the listing's Account tab.</div>
        <Field label="Account email" error={err.accountEmail} style={{ marginTop: 10 }}>
          <input value={f.accountEmail} onChange={set('accountEmail')} placeholder="owner@gmail.com" aria-label="Account email" className={`input ${err.accountEmail ? 'invalid' : ''}`} autoComplete="off" />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 13 }}>
          <Field label="Password">
            <div style={{ position: 'relative' }}>
              <input
                type={showPw ? 'text' : 'password'}
                value={f.accountPassword}
                onChange={set('accountPassword')}
                placeholder={mode === 'edit' && listing?.hasPassword ? '•••••••• (unchanged)' : '••••••••'}
                aria-label="Account password"
                className="input"
                autoComplete="new-password"
                style={{ paddingRight: 36 }}
              />
              <button type="button" onClick={() => setShowPw((v) => !v)} aria-label="Toggle password visibility" className="ghost-btn" style={{ position: 'absolute', right: 5, top: '50%', transform: 'translateY(-50%)', width: 28, height: 28, color: showPw ? 'var(--accentInk)' : 'var(--faint)' }}>
                <Icon d={IC.eye} size={14} />
              </button>
            </div>
          </Field>
          <Field label="2FA (TOTP) secret" error={err.totpSecret}>
            <input value={f.totpSecret} onChange={set('totpSecret')} placeholder={mode === 'edit' && listing?.hasTotp ? 'saved (unchanged)' : 'u4bp exv6 idrt kefo …'} aria-label="TOTP secret" className={`input mono ${err.totpSecret ? 'invalid' : ''}`} style={{ fontSize: 12 }} autoComplete="off" />
          </Field>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', marginTop: 20 }}>
        <button onClick={onClose} className="btn btn-outline" style={{ fontSize: 13, padding: '9px 14px' }}>
          Cancel
        </button>
        <button onClick={() => void save()} disabled={busy} className="btn btn-primary" style={{ fontSize: 13, padding: '9px 16px' }}>
          {busy ? <Icon d={IC.spinner} size={12} stroke={3} spin color="#fff" /> : null}
          {mode === 'add' ? (busy ? 'Adding & checking…' : 'Add & check now') : 'Save changes'}
        </button>
      </div>
    </Modal>
  );
}
