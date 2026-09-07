import { alertLogs, checkRuns, listings as listingsRepo, type CheckRun, type CheckTrigger, type Listing, type ListingStatus } from './db';
import { config } from './env';
import { CID_PREFIX, checkPlace, isCidPlaceId, type PlaceCheckOutcome } from './google-places';
import { UniqueConstraintError } from './db';
import { checkPlaceViaMapsPage } from './maps-page-check';
import { alertEventLabel, sendStatusChangeAlert } from './notifications';
import { effectiveCheckMode, getAppSettings, type AppSettings } from './settings';

/** Run the configured check strategy for one listing. */
async function runCheckStrategy(listing: Listing, settings: AppSettings): Promise<PlaceCheckOutcome> {
  const mode = effectiveCheckMode(settings);
  const pageId = { placeId: listing.placeId, cid: listing.cid, name: listing.name, sourceUrl: listing.sourceUrl };

  if (mode !== 'api') {
    const free = await checkPlaceViaMapsPage(pageId);
    if (free.ok || mode === 'free') return free;
    return checkPlace(listing.placeId); // free-then-api: page inconclusive → API
  }

  const api = await checkPlace(listing.placeId);

  // The Places API index lags behind Maps: a brand-new or recently re-verified
  // profile is visible on Maps but returns NOT_FOUND here ("Place ID is no
  // longer valid"). Never drop a listing on that alone — confirm on the public
  // Maps page first, and keep it ACTIVE when the page still shows it.
  // Only when the API itself says the id is stale (NOT_FOUND). An INVALID_REQUEST
  // means the id is malformed/unknown — there is nothing to rescue.
  if (api.ok && api.status === 'SUSPENDED' && api.googleStatus === 'NOT_FOUND' && (listing.sourceUrl || listing.cid)) {
    const page = await checkPlaceViaMapsPage(pageId);
    if (page.ok && page.status !== 'SUSPENDED') {
      return {
        ...page,
        detail: `${page.detail ?? 'Live on Google Maps'} — the Places API reports this id as stale (${api.googleStatus}); the public Maps page still shows the business, so it is treated as live.`,
      };
    }
  }
  return api;
}

/**
 * Core monitoring logic shared by the cron job, the manual-check endpoint,
 * bulk import and the "check on create" behaviour of POST /api/listings.
 */

export interface ListingCheckResult {
  listingId: string;
  name: string;
  placeId: string;
  previousStatus: ListingStatus;
  newStatus: ListingStatus;
  changed: boolean;
  googleStatus: string | null;
  businessStatus: string | null;
  /** Non-null when the check could not determine a status (quota, network…). */
  error: string | null;
  /** How the status was decided (free Maps-page checks). */
  detail: string | null;
  alertSent: boolean;
  checkedAt: string;
}

export interface CheckRunSummary {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  /** Listings handed to the runner. */
  total: number;
  /** Listings for which a definitive status was obtained. */
  checked: number;
  /** Listings whose status changed. */
  changed: number;
  /** Listings that errored (status untouched). */
  errors: number;
  /** Listings not attempted because the time budget ran out. */
  skipped: number;
  changes: ListingCheckResult[];
  failures: ListingCheckResult[];
  results: ListingCheckResult[];
}

export interface RunChecksOptions {
  /** Parallel requests per batch. Defaults to GMB_CHECK_CONCURRENCY (10). */
  concurrency?: number;
  /** Pause between batches in ms. Defaults to GMB_BATCH_DELAY_MS (0). */
  batchDelayMs?: number;
  /**
   * Stop starting new batches once this many ms have elapsed. Whatever is left
   * is reported as `skipped` and is picked up first on the next run (listings
   * are processed stalest-first).
   */
  timeBudgetMs?: number;
  /** Pre-loaded settings (avoids re-reading per listing). */
  settings?: AppSettings;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : 'Unknown error';
}

/**
 * Check one listing against Google, persist the result, write an audit log,
 * fire alerts when the status changed and record every alert delivery.
 *
 * Transient API failures leave `currentStatus` untouched and only record
 * `lastError`, so a Google outage never produces false "suspended" alerts.
 */
export async function checkListing(listing: Listing, options: { settings?: AppSettings } = {}): Promise<ListingCheckResult> {
  const checkedAt = new Date();
  const base = {
    listingId: listing.id,
    name: listing.name,
    placeId: listing.placeId,
    previousStatus: listing.currentStatus,
    checkedAt: checkedAt.toISOString(),
  };

  const settingsForCheck = options.settings ?? getAppSettings();
  const outcome = await runCheckStrategy(listing, settingsForCheck);

  // --- Transient / non-definitive failure -----------------------------------
  if (!outcome.ok) {
    try {
      listingsRepo.markError(listing.id, outcome.reason);
    } catch (dbErr) {
      console.error(`[gmb-checker] failed to record lastError for ${listing.id}:`, errorMessage(dbErr));
    }
    return {
      ...base,
      newStatus: listing.currentStatus,
      changed: false,
      googleStatus: outcome.googleStatus,
      businessStatus: null,
      error: outcome.reason,
      detail: null,
      alertSent: false,
    };
  }

  const newStatus = outcome.status;
  const previousStatus = listing.currentStatus;

  // --- "cid:" listings: Google told us the real Place ID → store it ---------
  if (isCidPlaceId(listing.placeId) && outcome.resolvedPlaceId && !isCidPlaceId(outcome.resolvedPlaceId)) {
    try {
      listingsRepo.update(listing.id, { cid: listing.cid ?? listing.placeId.slice(CID_PREFIX.length) });
      listingsRepo.updatePlaceId(listing.id, outcome.resolvedPlaceId);
      base.placeId = outcome.resolvedPlaceId;
    } catch (err) {
      if (err instanceof UniqueConstraintError) console.warn(`[gmb-checker] ${listing.name}: Place ID ${outcome.resolvedPlaceId} already monitored by another listing`);
      else console.error(`[gmb-checker] failed to store resolved Place ID for ${listing.id}:`, errorMessage(err));
    }
  }

  // --- No change (but record that the first check happened) ------------------
  if (newStatus === previousStatus) {
    listingsRepo.markChecked(listing.id, checkedAt);
    return {
      ...base,
      newStatus,
      changed: false,
      googleStatus: outcome.googleStatus,
      businessStatus: outcome.businessStatus,
      error: null,
      detail: outcome.detail ?? null,
      alertSent: false,
    };
  }

  // --- Status changed: update + audit log atomically -----------------------
  listingsRepo.applyStatusChange({
    id: listing.id,
    previousStatus,
    newStatus,
    rawApiResponse: outcome.raw,
    checkedAt,
  });

  console.info(`[gmb-checker] ${listing.name} (${listing.placeId}): ${previousStatus} -> ${newStatus}`);

  // --- Alert (drop OR recovery). Never throws. ------------------------------
  let alertSent = false;
  try {
    const settings = options.settings ?? getAppSettings();
    const dispatch = await sendStatusChangeAlert(
      {
        listingId: listing.id,
        name: listing.name,
        placeId: listing.placeId,
        cid: listing.cid,
        city: listing.city,
        previousStatus,
        newStatus,
        checkedAt,
        googleStatus: outcome.googleStatus,
        businessStatus: outcome.businessStatus,
      },
      { settings },
    );
    alertSent = dispatch.channels.some((c) => c.status === 'sent');

    const event = alertEventLabel({ previousStatus, newStatus });
    for (const ch of dispatch.channels) {
      if (ch.status === 'skipped') continue; // channel not configured
      alertLogs.create({
        listingId: listing.id,
        channel: ch.channel,
        status: ch.status === 'sent' ? 'SENT' : 'FAILED',
        recipient: ch.recipient,
        event,
        previousStatus,
        newStatus,
        error: ch.error,
      });
    }
    if (dispatch.suppressedReason) {
      console.info(`[gmb-checker] alert suppressed for ${listing.id}: ${dispatch.suppressedReason}`);
    }
  } catch (err) {
    console.error(`[gmb-checker] alert dispatch threw for ${listing.id}:`, errorMessage(err));
  }

  return {
    ...base,
    newStatus,
    changed: true,
    googleStatus: outcome.googleStatus,
    businessStatus: outcome.businessStatus,
    error: null,
    detail: outcome.detail ?? null,
    alertSent,
  };
}

function failedResult(listing: Listing, reason: unknown): ListingCheckResult {
  return {
    listingId: listing.id,
    name: listing.name,
    placeId: listing.placeId,
    previousStatus: listing.currentStatus,
    newStatus: listing.currentStatus,
    changed: false,
    googleStatus: null,
    businessStatus: null,
    error: errorMessage(reason),
    detail: null,
    alertSent: false,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Process listings in fixed-size batches with `Promise.allSettled`, so one
 * rejected promise never aborts the batch. Honors an optional time budget.
 */
export async function runChecks(listings: Listing[], options: RunChecksOptions = {}): Promise<CheckRunSummary> {
  const startedAt = Date.now();
  const settings = options.settings ?? getAppSettings();
  const freeChecks = effectiveCheckMode(settings) !== 'api';
  // Page scraping must stay gentle or Google starts serving captchas.
  const concurrency = clamp(options.concurrency ?? (freeChecks ? Math.min(2, config.checkConcurrency) : config.checkConcurrency), 1, freeChecks ? 3 : 50);
  const batchDelayMs = clamp(options.batchDelayMs ?? (freeChecks ? Math.max(700, config.batchDelayMs) : config.batchDelayMs), 0, 10_000);
  const timeBudgetMs = options.timeBudgetMs;

  const results: ListingCheckResult[] = [];
  let skipped = 0;

  for (let i = 0; i < listings.length; i += concurrency) {
    if (timeBudgetMs !== undefined && Date.now() - startedAt > timeBudgetMs) {
      skipped = listings.length - i;
      console.warn(`[gmb-checker] time budget exhausted after ${i} listings, skipping ${skipped}`);
      break;
    }

    const batch = listings.slice(i, i + concurrency);
    const settled = await Promise.allSettled(batch.map((listing) => checkListing(listing, { settings })));

    settled.forEach((outcome, idx) => {
      results.push(outcome.status === 'fulfilled' ? outcome.value : failedResult(batch[idx], outcome.reason));
    });

    if (batchDelayMs > 0 && i + concurrency < listings.length) {
      await sleep(batchDelayMs);
    }
  }

  const finishedAt = Date.now();
  const changes = results.filter((r) => r.changed);
  const failures = results.filter((r) => r.error !== null);

  return {
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    durationMs: finishedAt - startedAt,
    total: listings.length,
    checked: results.length - failures.length,
    changed: changes.length,
    errors: failures.length,
    skipped,
    changes,
    failures,
    results,
  };
}

/** Load every monitored listing (stalest first) and run the checks. */
export async function runChecksForAllListings(options: RunChecksOptions = {}): Promise<CheckRunSummary> {
  const all = listingsRepo.all({ monitoringEnabled: true });
  return runChecks(all, options);
}

/** Persist a run summary so the dashboard / schedule page can show "last run". */
export function recordCheckRun(trigger: CheckTrigger, summary: CheckRunSummary): CheckRun | null {
  try {
    return checkRuns.create({
      trigger,
      startedAt: summary.startedAt,
      finishedAt: summary.finishedAt,
      durationMs: summary.durationMs,
      total: summary.total,
      checked: summary.checked,
      changed: summary.changed,
      errors: summary.errors,
      skipped: summary.skipped,
    });
  } catch (err) {
    console.error('[gmb-checker] failed to record check run:', errorMessage(err));
    return null;
  }
}

/** Strip the bulky per-listing array for API responses / logs. */
export function summaryWithoutResults(summary: CheckRunSummary): Omit<CheckRunSummary, 'results'> {
  const { results: _results, ...rest } = summary;
  return rest;
}
