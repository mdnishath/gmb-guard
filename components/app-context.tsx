'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiClientError, type CheckSummary } from '@/lib/client/api';

export type ThemePref = 'light' | 'dark' | 'system';
export type ToastTone = 'ok' | 'bad' | 'warn' | 'na';

export interface Toast {
  id: number;
  title: string;
  msg?: string;
  actLabel?: string;
  act?: () => void;
  tone: ToastTone;
}

export interface ConfirmState {
  title: string;
  msg: string;
  label: string;
  onYes: () => void | Promise<void>;
}

export interface CheckAllState {
  running: boolean;
  startedAt: number;
  total: number;
  /** Listings checked so far (updates live while running). */
  done: number;
  /** Running tallies while the check is in progress. */
  changed: number;
  errors: number;
  /** Set when the last run finished. */
  last?: { at: number; summary: CheckSummary };
}

interface AppContextValue {
  themePref: ThemePref;
  theme: 'light' | 'dark';
  setThemePref: (p: ThemePref) => void;
  toggleTheme: () => void;

  toasts: Toast[];
  toast: (title: string, msg?: string, opts?: { actLabel?: string; act?: () => void; tone?: ToastTone }) => void;
  dismissToast: (id: number) => void;

  confirm: ConfirmState | null;
  askConfirm: (c: ConfirmState) => void;
  closeConfirm: () => void;

  checkAll: CheckAllState;
  startCheckAll: () => Promise<void>;
  cancelCheckAll: () => void;

  /** Bumped after any mutation that other views should reload for. */
  refreshKey: number;
  bumpRefresh: () => void;

  drawerId: string | null;
  drawerTab: 'history' | 'alerts' | 'notes' | 'account';
  openDrawer: (id: string, tab?: 'history' | 'alerts' | 'notes' | 'account') => void;
  closeDrawer: () => void;

  sideOpen: boolean;
  toggleSide: () => void;

  cmdOpen: boolean;
  setCmdOpen: (v: boolean) => void;

  vw: 'sm' | 'md' | 'lg';
  errorMessage: (err: unknown) => string;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [themePref, setThemePrefState] = useState<ThemePref>('light');
  const [sysDark, setSysDark] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [checkAll, setCheckAll] = useState<CheckAllState>({ running: false, startedAt: 0, total: 0, done: 0, changed: 0, errors: 0 });
  const checkAbort = useRef(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [drawerTab, setDrawerTab] = useState<'history' | 'alerts' | 'notes' | 'account'>('history');
  const [sideOpen, setSideOpen] = useState(true);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [vw, setVw] = useState<'sm' | 'md' | 'lg'>('lg');
  const toastId = useRef(0);

  // --- theme -----------------------------------------------------------------
  useEffect(() => {
    try {
      const saved = localStorage.getItem('gmb-theme') as ThemePref | null;
      if (saved === 'light' || saved === 'dark' || saved === 'system') setThemePrefState(saved);
      const side = localStorage.getItem('gmb-side');
      if (side === '0') setSideOpen(false);
    } catch {
      /* ignore */
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setSysDark(mq.matches);
    const onMq = (e: MediaQueryListEvent) => setSysDark(e.matches);
    mq.addEventListener('change', onMq);
    return () => mq.removeEventListener('change', onMq);
  }, []);

  const theme: 'light' | 'dark' = themePref === 'system' ? (sysDark ? 'dark' : 'light') : themePref;

  useEffect(() => {
    document.documentElement.setAttribute('data-th', theme);
  }, [theme]);

  const setThemePref = useCallback((p: ThemePref) => {
    setThemePrefState(p);
    try {
      localStorage.setItem('gmb-theme', p);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleTheme = useCallback(() => setThemePref(theme === 'dark' ? 'light' : 'dark'), [theme, setThemePref]);

  // --- viewport --------------------------------------------------------------
  useEffect(() => {
    const onRes = () => {
      const w = window.innerWidth;
      setVw(w < 740 ? 'sm' : w < 1120 ? 'md' : 'lg');
    };
    onRes();
    window.addEventListener('resize', onRes);
    return () => window.removeEventListener('resize', onRes);
  }, []);

  // --- toasts ----------------------------------------------------------------
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const toast = useCallback<AppContextValue['toast']>(
    (title, msg, opts) => {
      const id = ++toastId.current;
      setToasts((t) => [...t, { id, title, msg, actLabel: opts?.actLabel, act: opts?.act, tone: opts?.tone ?? 'ok' }]);
      setTimeout(() => dismissToast(id), 6000);
    },
    [dismissToast],
  );

  // --- confirm ---------------------------------------------------------------
  const askConfirm = useCallback((c: ConfirmState) => setConfirm(c), []);
  const closeConfirm = useCallback(() => setConfirm(null), []);

  const bumpRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // --- check all -------------------------------------------------------------
  // Runs in small batches from the browser so the table updates as results land,
  // instead of waiting for one long server call.
  const cancelCheckAll = useCallback(() => {
    checkAbort.current = true;
  }, []);

  const startCheckAll = useCallback(async () => {
    if (checkAll.running) return;
    checkAbort.current = false;

    // Collect every monitored listing, stalest first.
    const ids: string[] = [];
    try {
      let page = 1;
      for (;;) {
        const r = await api.listings.list({ page, pageSize: 100, sortBy: 'lastCheckedAt', sortDir: 'asc' });
        ids.push(...r.items.filter((l) => l.monitoringEnabled).map((l) => l.id));
        if (!r.pagination.hasNextPage || page >= 100) break;
        page++;
      }
    } catch (err) {
      toast('Check failed', errorMessage(err), { tone: 'bad' });
      return;
    }
    const total = ids.length;
    if (total === 0) {
      toast('Nothing to check', 'Add or import businesses first.', { tone: 'na' });
      return;
    }

    const startedAt = Date.now();
    setCheckAll({ running: true, startedAt, total, done: 0, changed: 0, errors: 0 });

    const BATCH = 8;
    const agg: CheckSummary = { startedAt: new Date(startedAt).toISOString(), finishedAt: '', durationMs: 0, total, checked: 0, changed: 0, errors: 0, skipped: 0, changes: [], failures: [] };
    let done = 0;
    let stopped = false;
    let failedBatches = 0;

    for (let i = 0; i < ids.length; i += BATCH) {
      if (checkAbort.current) {
        stopped = true;
        break;
      }
      const chunk = ids.slice(i, i + BATCH);
      try {
        const r = await api.listings.checkMany(chunk);
        agg.checked += r.checked;
        agg.changed += r.changed;
        agg.errors += r.errors;
        agg.changes.push(...r.changes);
        agg.failures.push(...r.failures);
      } catch (err) {
        failedBatches++;
        agg.errors += chunk.length;
        if (err instanceof ApiClientError && err.status === 429) {
          // Rate limited: wait for the window and retry this batch once.
          const wait = ((err.details as { retryAfterSec?: number } | undefined)?.retryAfterSec ?? 5) * 1000;
          await new Promise((res) => setTimeout(res, wait));
          i -= BATCH;
          continue;
        }
        if (failedBatches >= 3) {
          toast('Check aborted', errorMessage(err), { tone: 'bad' });
          stopped = true;
          break;
        }
      }
      done = Math.min(total, i + chunk.length);
      setCheckAll({ running: true, startedAt, total, done, changed: agg.changed, errors: agg.errors });
      bumpRefresh(); // tables, drawer and dashboard reload with the fresh statuses
    }

    agg.skipped = total - done;
    agg.finishedAt = new Date().toISOString();
    agg.durationMs = Date.now() - startedAt;
    setCheckAll({ running: false, startedAt: 0, total, done, changed: agg.changed, errors: agg.errors, last: { at: Date.now(), summary: agg } });
    bumpRefresh();
    api.recordCheckRun({ trigger: 'MANUAL', ...agg }).catch(() => {});

    const recovered = agg.changes.filter((c) => c.newStatus === 'ACTIVE').length;
    const dropped = agg.changes.length - recovered;
    const parts = [`${agg.checked} listings checked`];
    if (dropped) parts.push(`${dropped} dropped`);
    if (recovered) parts.push(`${recovered} came back live`);
    if (agg.errors) parts.push(`${agg.errors} errors`);
    if (!dropped && !recovered && !agg.errors) parts.push('no status changes');
    if (stopped) parts.push(`stopped with ${agg.skipped} left`);
    toast(stopped ? 'Check stopped' : 'Check complete', parts.join(' · '), { tone: dropped ? 'bad' : agg.errors ? 'warn' : stopped ? 'na' : 'ok' });
  }, [checkAll.running, toast, bumpRefresh]);

  // --- drawer / sidebar / palette --------------------------------------------
  const openDrawer = useCallback((id: string, tab: 'history' | 'alerts' | 'notes' | 'account' = 'history') => {
    setDrawerId(id);
    setDrawerTab(tab);
  }, []);
  const closeDrawer = useCallback(() => setDrawerId(null), []);

  const toggleSide = useCallback(() => {
    setSideOpen((v) => {
      try {
        localStorage.setItem('gmb-side', v ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !v;
    });
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      themePref,
      theme,
      setThemePref,
      toggleTheme,
      toasts,
      toast,
      dismissToast,
      confirm,
      askConfirm,
      closeConfirm,
      checkAll,
      startCheckAll,
      cancelCheckAll,
      refreshKey,
      bumpRefresh,
      drawerId,
      drawerTab,
      openDrawer,
      closeDrawer,
      sideOpen,
      toggleSide,
      cmdOpen,
      setCmdOpen,
      vw,
      errorMessage,
    }),
    [
      themePref,
      theme,
      setThemePref,
      toggleTheme,
      toasts,
      toast,
      dismissToast,
      confirm,
      askConfirm,
      closeConfirm,
      checkAll,
      startCheckAll,
      cancelCheckAll,
      refreshKey,
      bumpRefresh,
      drawerId,
      drawerTab,
      openDrawer,
      closeDrawer,
      sideOpen,
      toggleSide,
      cmdOpen,
      vw,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
