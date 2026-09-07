'use client';

import { useState } from 'react';
import { api, type EnrichResult } from '@/lib/client/api';
import { ENRICH_FIELDS, ENRICH_FIELD_LABELS, type EnrichField } from '@/lib/enrich-fields';
import { useApp, errorMessage } from './app-context';
import { IC, Icon, Modal, Radio } from './ui';

/**
 * Pulls the real profile (phone, category, address, city…) from Google for the
 * chosen listings. Runs in batches until every listing in scope has been asked
 * about, so a few hundred listings finish in one click.
 */
export function EnrichModal({ onClose, selectedIds, totalCount }: { onClose: () => void; selectedIds: string[]; totalCount: number }) {
  const app = useApp();
  const [fields, setFields] = useState<Record<EnrichField, boolean>>({
    phone: true,
    category: true,
    address: true,
    city: true,
    website: false,
    name: false,
  });
  const [mode, setMode] = useState<'missing' | 'overwrite'>('missing');
  const [scope, setScope] = useState<'missing-any' | 'all' | 'selected'>(selectedIds.length ? 'selected' : 'missing-any');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ processed: number; total: number } | null>(null);
  const [result, setResult] = useState<EnrichResult | null>(null);

  const chosen = ENRICH_FIELDS.filter((f) => fields[f]);
  const scopeCount = scope === 'selected' ? selectedIds.length : totalCount;

  const run = async () => {
    if (chosen.length === 0) return;
    setBusy(true);
    setResult(null);
    const totals: EnrichResult = {
      candidates: 0,
      processed: 0,
      updated: 0,
      unchanged: 0,
      failed: 0,
      perField: {},
      remaining: 0,
      nextCursor: null,
      samples: [],
      errors: [],
    };
    let cursor: string | null = null;
    try {
      for (let round = 0; round < 60; round++) {
        const r: EnrichResult = await api.listings.enrich({
          fields: chosen,
          mode,
          scope,
          listingIds: scope === 'selected' ? selectedIds : undefined,
          limit: 150,
          cursor: cursor ?? undefined,
        });
        totals.processed += r.processed;
        totals.updated += r.updated;
        totals.unchanged += r.unchanged;
        totals.failed += r.failed;
        for (const [k, v] of Object.entries(r.perField)) totals.perField[k] = (totals.perField[k] ?? 0) + v;
        if (totals.samples.length < 10) totals.samples.push(...r.samples.slice(0, 10 - totals.samples.length));
        for (const e of r.errors) if (totals.errors.length < 8) totals.errors.push(e);
        setProgress({ processed: totals.processed, total: totals.processed + r.remaining });
        cursor = r.nextCursor;
        if (r.remaining === 0 || r.processed === 0 || !cursor) break;
      }
      setResult(totals);
      app.bumpRefresh();
      app.toast('Details pulled from Google', `${totals.updated} listings updated${totals.failed ? `, ${totals.failed} could not be read` : ''}.`);
    } catch (err) {
      app.toast('Could not pull details', errorMessage(err), { tone: 'bad' });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const scopes: ReadonlyArray<readonly [typeof scope, string, string]> = [
    ['missing-any', 'Listings missing one of these fields', 'safest'],
    ['all', 'All listings', `${totalCount}`],
    ...(selectedIds.length ? ([['selected', 'Selected rows', `${selectedIds.length}`]] as const) : []),
  ];

  return (
    <Modal title="Pull details from Google" onClose={onClose} width={540}>
      <div className="card-sub" style={{ marginTop: 4 }}>
        Reads each listing&apos;s real Google Business Profile and copies the fields you pick into the database. One Google API call per listing.
      </div>

      <div className="label" style={{ marginTop: 16 }}>Fields to pull</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(155px,1fr))', gap: 6, marginTop: 8 }}>
        {ENRICH_FIELDS.map((f) => (
          <button
            key={f}
            onClick={() => setFields((x) => ({ ...x, [f]: !x[f] }))}
            disabled={busy}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              padding: '9px 11px',
              borderRadius: 9,
              border: `1px solid ${fields[f] ? 'var(--accentBorder)' : 'var(--border)'}`,
              background: fields[f] ? 'var(--accentSoft)' : 'var(--surface)',
              textAlign: 'left',
            }}
          >
            <span
              style={{
                width: 16,
                height: 16,
                borderRadius: 5,
                border: `1.5px solid ${fields[f] ? 'var(--accent)' : 'var(--border2)'}`,
                background: fields[f] ? 'var(--accent)' : 'var(--inputBg)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flex: '0 0 auto',
              }}
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4" style={{ opacity: fields[f] ? 1 : 0 }}>
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>{ENRICH_FIELD_LABELS[f]}</span>
          </button>
        ))}
      </div>

      <div className="label" style={{ marginTop: 16 }}>When a value already exists</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
        {(
          [
            ['missing', 'Only fill what is empty', 'Existing values are kept exactly as they are.'],
            ['overwrite', 'Replace with Google’s value', 'Use this to correct wrong data — e.g. one phone number pasted into many rows.'],
          ] as const
        ).map(([k, l, sub]) => (
          <button
            key={k}
            onClick={() => setMode(k)}
            disabled={busy}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '10px 12px',
              borderRadius: 10,
              background: mode === k ? 'var(--accentSoft)' : 'var(--surface)',
              border: `1px solid ${mode === k ? 'var(--accentBorder)' : 'var(--border)'}`,
              textAlign: 'left',
            }}
          >
            <Radio on={mode === k} />
            <span>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 700 }}>{l}</span>
              <span style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)', marginTop: 1 }}>{sub}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="label" style={{ marginTop: 16 }}>Which listings</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
        {scopes.map(([k, l, sub]) => (
          <button
            key={k}
            onClick={() => setScope(k)}
            disabled={busy}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 12px',
              borderRadius: 10,
              background: scope === k ? 'var(--accentSoft)' : 'var(--surface)',
              border: `1px solid ${scope === k ? 'var(--accentBorder)' : 'var(--border)'}`,
              textAlign: 'left',
            }}
          >
            <Radio on={scope === k} />
            <span style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>{l}</span>
            <span className="tnum" style={{ fontSize: 11.5, color: 'var(--faint)' }}>{sub}</span>
          </button>
        ))}
      </div>

      {mode === 'overwrite' ? (
        <div style={{ marginTop: 14, padding: '10px 12px', border: '1px solid var(--warnBd)', background: 'var(--warnBg)', borderRadius: 10, fontSize: 12, color: 'var(--warn)', fontWeight: 600 }}>
          Overwrite replaces the ticked fields on up to {scopeCount} listings. The old values are not recoverable — take a backup first if you are unsure.
        </div>
      ) : null}

      {busy && progress ? (
        <div style={{ marginTop: 14 }}>
          <div className="tnum" style={{ fontSize: 12, color: 'var(--muted)' }}>
            Asking Google… {progress.processed} / {progress.total || '?'}
          </div>
          <div className="progress" style={{ height: 6, marginTop: 6 }}>
            <i style={{ width: progress.total ? `${Math.min(100, (progress.processed / progress.total) * 100)}%` : '10%' }} />
          </div>
        </div>
      ) : null}

      {result ? (
        <div style={{ marginTop: 14, padding: '11px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--well)' }}>
          <div style={{ fontSize: 12.5, fontWeight: 700 }}>
            {result.updated} updated · {result.unchanged} already correct
            {result.failed ? ` · ${result.failed} could not be read` : ''}
          </div>
          {Object.keys(result.perField).length ? (
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>
              {Object.entries(result.perField)
                .map(([k, v]) => `${ENRICH_FIELD_LABELS[k as EnrichField] ?? k}: ${v}`)
                .join(' · ')}
            </div>
          ) : null}
          {result.samples.length ? (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 150, overflowY: 'auto' }}>
              {result.samples.map((s, i) => (
                <div key={i} style={{ fontSize: 11.5 }}>
                  <span style={{ fontWeight: 700 }}>{s.name}</span>
                  {Object.entries(s.changes).map(([f, c]) => (
                    <span key={f} style={{ color: 'var(--muted)' }}>
                      {' '}
                      · {f}: {c.from ? <s>{c.from}</s> : <em>empty</em>} → {c.to}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          ) : null}
          {result.errors.length ? <div className="err" style={{ marginTop: 6 }}>{result.errors[0]}</div> : null}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', marginTop: 18 }}>
        <button onClick={onClose} className="btn btn-outline" style={{ fontSize: 13, padding: '9px 14px' }}>
          {result ? 'Close' : 'Cancel'}
        </button>
        <button onClick={() => void run()} disabled={busy || chosen.length === 0} className="btn btn-primary" style={{ fontSize: 13, padding: '9px 16px' }}>
          {busy ? <Icon d={IC.spinner} size={12} stroke={3} spin color="#fff" /> : <Icon d={IC.download} size={13} stroke={2.2} />}
          {busy ? 'Pulling…' : `Pull from Google`}
        </button>
      </div>
    </Modal>
  );
}
