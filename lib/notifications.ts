import type { ListingStatus } from './db';
import { config, getEnv } from './env';
import { googleMapsUrl } from './google-places';
import type { AppSettings } from './settings';

/**
 * Immediate alerting: Telegram (bot API) and/or Email (Resend REST API).
 *
 * Each channel is optional — it is skipped when its env vars are missing.
 * Nothing in this module throws to the caller: a failed alert must never
 * roll back a status change that was already persisted.
 */

export interface StatusChangeAlert {
  listingId: string;
  name: string;
  placeId: string;
  cid: string | null;
  city?: string | null;
  previousStatus: ListingStatus;
  newStatus: ListingStatus;
  checkedAt: Date;
  googleStatus?: string | null;
  businessStatus?: string | null;
}

export type ChannelResult = 'sent' | 'skipped' | 'failed';
export type AlertChannelName = 'TELEGRAM' | 'EMAIL';

export interface ChannelDispatch {
  channel: AlertChannelName;
  status: ChannelResult;
  recipient: string | null;
  error: string | null;
}

export interface AlertDispatchResult {
  telegram: ChannelResult;
  email: ChannelResult;
  errors: string[];
  channels: ChannelDispatch[];
  /** Why the whole alert was suppressed (preferences), if it was. */
  suppressedReason: string | null;
}

/** Minimal shape of a run summary needed for the digest message. */
export interface RunSummaryForDigest {
  total: number;
  checked: number;
  changed: number;
  errors: number;
  skipped: number;
  durationMs: number;
  changes: Array<{ name: string; previousStatus: ListingStatus; newStatus: ListingStatus }>;
  failures: Array<{ name: string; error: string | null }>;
}

// ---------------------------------------------------------------------------
// Classification helpers
// ---------------------------------------------------------------------------

export function isDrop(alert: Pick<StatusChangeAlert, 'previousStatus' | 'newStatus'>): boolean {
  return alert.previousStatus === 'ACTIVE' && alert.newStatus !== 'ACTIVE';
}

export function isRecovery(alert: Pick<StatusChangeAlert, 'previousStatus' | 'newStatus'>): boolean {
  return alert.previousStatus !== 'ACTIVE' && alert.newStatus === 'ACTIVE';
}

/** Short event label stored in AlertLog.event. */
export function alertEventLabel(alert: Pick<StatusChangeAlert, 'previousStatus' | 'newStatus'>): string {
  if (isRecovery(alert)) return 'RECOVERED';
  if (alert.newStatus === 'SUSPENDED') return 'SUSPENDED';
  if (alert.newStatus === 'CLOSED') return 'CLOSED';
  return 'CHANGED';
}

const STATUS_LABEL: Record<ListingStatus, string> = {
  ACTIVE: 'Live',
  SUSPENDED: 'Suspended / Not found',
  CLOSED: 'Closed',
};

function headline(alert: StatusChangeAlert): { emoji: string; title: string } {
  if (isRecovery(alert)) return { emoji: '✅', title: 'GMB back live' };
  if (alert.newStatus === 'SUSPENDED') return { emoji: '🚨', title: 'GMB suspended / removed' };
  if (alert.newStatus === 'CLOSED') return { emoji: '⛔', title: 'GMB marked closed' };
  return { emoji: 'ℹ️', title: 'GMB status changed' };
}

function formatUtc(date: Date): string {
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function dashboardLink(listingId: string): string | null {
  const base = config.appUrl;
  return base ? `${base.replace(/\/$/, '')}/businesses?listing=${encodeURIComponent(listingId)}` : null;
}

// ---------------------------------------------------------------------------
// Message formatting
// ---------------------------------------------------------------------------

export function formatTelegramMessage(alert: StatusChangeAlert): string {
  const { emoji, title } = headline(alert);
  const lines: string[] = [
    `${emoji} <b>${escapeHtml(title)}</b>`,
    '',
    `<b>${escapeHtml(alert.name)}</b>${alert.city ? ` · ${escapeHtml(alert.city)}` : ''}`,
    `Status: ${STATUS_LABEL[alert.previousStatus]} → <b>${STATUS_LABEL[alert.newStatus]}</b>`,
  ];

  if (alert.googleStatus) {
    const detail = alert.businessStatus ? ` (${alert.businessStatus})` : '';
    lines.push(`Google: <code>${escapeHtml(alert.googleStatus + detail)}</code>`);
  }
  lines.push(`Place ID: <code>${escapeHtml(alert.placeId)}</code>`);
  if (alert.cid) lines.push(`CID: <code>${escapeHtml(alert.cid)}</code>`);
  lines.push(`Checked: ${formatUtc(alert.checkedAt)}`);
  lines.push('');
  lines.push(`🔗 <a href="${escapeHtml(googleMapsUrl(alert.placeId, alert.cid))}">Open in Google Maps</a>`);

  const dash = dashboardLink(alert.listingId);
  if (dash) lines.push(`📊 <a href="${escapeHtml(dash)}">Open in dashboard</a>`);

  return lines.join('\n');
}

export function formatEmail(alert: StatusChangeAlert): { subject: string; html: string; text: string } {
  const { emoji, title } = headline(alert);
  const subject = `${emoji} ${title}: ${alert.name}`;
  const mapsUrl = googleMapsUrl(alert.placeId, alert.cid);
  const dash = dashboardLink(alert.listingId);

  const rows: Array<[string, string]> = [
    ['Business', alert.name + (alert.city ? ` (${alert.city})` : '')],
    ['Previous status', STATUS_LABEL[alert.previousStatus]],
    ['New status', STATUS_LABEL[alert.newStatus]],
    ['Google response', `${alert.googleStatus ?? '—'}${alert.businessStatus ? ` (${alert.businessStatus})` : ''}`],
    ['Place ID', alert.placeId],
    ['CID', alert.cid ?? '—'],
    ['Checked at', formatUtc(alert.checkedAt)],
  ];

  const text = [
    `${title}: ${alert.name}`,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    `Google Maps: ${mapsUrl}`,
    ...(dash ? [`Dashboard: ${dash}`] : []),
  ].join('\n');

  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#111">
  <h2 style="margin:0 0 4px">${emoji} ${escapeHtml(title)}</h2>
  <p style="margin:0 0 16px;color:#555">${escapeHtml(alert.name)}</p>
  <table style="border-collapse:collapse;width:100%;font-size:14px">
    ${rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:6px 8px;border:1px solid #e5e7eb;background:#f9fafb;white-space:nowrap"><b>${escapeHtml(k)}</b></td><td style="padding:6px 8px;border:1px solid #e5e7eb">${escapeHtml(v)}</td></tr>`,
      )
      .join('')}
  </table>
  <p style="margin:16px 0 0">
    <a href="${escapeHtml(mapsUrl)}">Open in Google Maps</a>
    ${dash ? ` &nbsp;·&nbsp; <a href="${escapeHtml(dash)}">Open in dashboard</a>` : ''}
  </p>
</div>`.trim();

  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Channel configuration (also used by the settings UI)
// ---------------------------------------------------------------------------

export function telegramConfig(): { configured: boolean; chatId: string | null } {
  const token = getEnv('TELEGRAM_BOT_TOKEN');
  const chatId = getEnv('TELEGRAM_CHAT_ID');
  return { configured: Boolean(token && chatId), chatId: chatId ?? null };
}

export function emailConfig(extra: string[] = []): { configured: boolean; from: string | null; recipients: string[]; envRecipients: string[] } {
  const apiKey = getEnv('RESEND_API_KEY');
  const from = getEnv('ALERT_EMAIL_FROM');
  const envRecipients = (getEnv('ALERT_EMAIL_TO') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const recipients = Array.from(new Set([...envRecipients, ...extra.map((s) => s.trim()).filter(Boolean)]));
  return { configured: Boolean(apiKey && from && recipients.length > 0), from: from ?? null, recipients, envRecipients };
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

/** Send a Telegram message. Returns 'skipped' when the bot is not configured. */
export async function sendTelegramMessage(text: string): Promise<ChannelResult> {
  const token = getEnv('TELEGRAM_BOT_TOKEN');
  const chatId = getEnv('TELEGRAM_CHAT_ID');
  if (!token || !chatId) return 'skipped';

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  const body = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
  if (!res.ok || !body?.ok) {
    throw new Error(`Telegram sendMessage failed (HTTP ${res.status}): ${body?.description ?? 'no description'}`);
  }
  return 'sent';
}

/** Send an email via Resend. Returns 'skipped' when Resend is not configured. */
export async function sendEmail(
  input: { subject: string; html: string; text: string },
  extraRecipients: string[] = [],
): Promise<ChannelResult> {
  const apiKey = getEnv('RESEND_API_KEY');
  const { configured, from, recipients } = emailConfig(extraRecipients);
  if (!apiKey || !configured || !from) return 'skipped';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: recipients, subject: input.subject, html: input.html, text: input.text }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend API failed (HTTP ${res.status}): ${body.slice(0, 300)}`);
  }
  return 'sent';
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

function settle(
  result: PromiseSettledResult<ChannelResult>,
  channel: AlertChannelName,
  recipient: string | null,
  errors: string[],
): ChannelDispatch {
  if (result.status === 'fulfilled') return { channel, status: result.value, recipient, error: null };
  const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
  errors.push(`${channel.toLowerCase()}: ${msg}`);
  console.error(`[notifications] ${channel} failed:`, msg);
  return { channel, status: 'failed', recipient, error: msg };
}

function skippedResult(reason: string): AlertDispatchResult {
  return { telegram: 'skipped', email: 'skipped', errors: [], channels: [], suppressedReason: reason };
}

function isAlertEnabled(alert: StatusChangeAlert, settings: AppSettings | undefined): string | null {
  if (!settings) return null;
  if (isRecovery(alert)) return settings.alertOnRecovered ? null : 'Recovery alerts are disabled in preferences';
  if (alert.newStatus === 'SUSPENDED') return settings.alertOnSuspended ? null : 'Suspension alerts are disabled in preferences';
  if (alert.newStatus === 'CLOSED') return settings.alertOnClosed ? null : 'Closed alerts are disabled in preferences';
  return null;
}

async function dispatch(
  text: string,
  email: { subject: string; html: string; text: string },
  extraRecipients: string[],
): Promise<AlertDispatchResult> {
  const errors: string[] = [];
  const tg = telegramConfig();
  const em = emailConfig(extraRecipients);

  const [tgRes, emRes] = await Promise.allSettled([sendTelegramMessage(text), sendEmail(email, extraRecipients)]);

  const channels = [
    settle(tgRes, 'TELEGRAM', tg.chatId ? `chat ${tg.chatId}` : null, errors),
    settle(emRes, 'EMAIL', em.recipients.length ? em.recipients.join(', ') : null, errors),
  ];

  return {
    telegram: channels[0].status,
    email: channels[1].status,
    errors,
    channels,
    suppressedReason: null,
  };
}

/**
 * Fire an instant alert for a status transition on both channels in parallel.
 * Honors alert preferences when `settings` is provided. Never throws.
 */
export async function sendStatusChangeAlert(
  alert: StatusChangeAlert,
  options: { settings?: AppSettings } = {},
): Promise<AlertDispatchResult> {
  const suppressed = isAlertEnabled(alert, options.settings);
  if (suppressed) return skippedResult(suppressed);

  const extra = options.settings?.extraEmailRecipients ?? [];
  return dispatch(formatTelegramMessage(alert), formatEmail(alert), extra);
}

/**
 * Optional end-of-run digest. Only sends when something noteworthy happened
 * (status changes, errors, or listings skipped due to the time budget), so a
 * quiet night produces no noise.
 */
export async function sendCheckRunSummary(
  summary: RunSummaryForDigest,
  options: { settings?: AppSettings } = {},
): Promise<AlertDispatchResult> {
  if (options.settings && !options.settings.digestEnabled) return skippedResult('Digest disabled in preferences');

  const noteworthy = summary.changed > 0 || summary.errors > 0 || summary.skipped > 0;
  if (!noteworthy) return skippedResult('Nothing to report');

  const seconds = (summary.durationMs / 1000).toFixed(1);
  const lines: string[] = [
    `🗓 <b>GMB daily check complete</b>`,
    `Checked ${summary.checked}/${summary.total} listings in ${seconds}s`,
    `Changes: <b>${summary.changed}</b> · Errors: ${summary.errors} · Skipped: ${summary.skipped}`,
  ];

  if (summary.changes.length) {
    lines.push('', '<b>Status changes</b>');
    for (const c of summary.changes.slice(0, 25)) {
      lines.push(`• ${escapeHtml(c.name)}: ${STATUS_LABEL[c.previousStatus]} → ${STATUS_LABEL[c.newStatus]}`);
    }
    if (summary.changes.length > 25) lines.push(`… and ${summary.changes.length - 25} more`);
  }

  if (summary.failures.length) {
    lines.push('', '<b>Check errors</b>');
    for (const f of summary.failures.slice(0, 10)) {
      lines.push(`• ${escapeHtml(f.name)}: ${escapeHtml(f.error ?? 'unknown')}`);
    }
    if (summary.failures.length > 10) lines.push(`… and ${summary.failures.length - 10} more`);
  }

  const text = lines.join('\n');
  const plain = text.replace(/<[^>]+>/g, '');
  const extra = options.settings?.extraEmailRecipients ?? [];

  return dispatch(
    text,
    {
      subject: `GMB daily check: ${summary.changed} change(s), ${summary.errors} error(s)`,
      html: `<pre style="font-family:inherit;white-space:pre-wrap">${text}</pre>`,
      text: plain,
    },
    extra,
  );
}

/** Send a test message on every configured channel (used by the settings UI). */
export async function sendTestAlert(extraRecipients: string[] = []): Promise<AlertDispatchResult> {
  const text = `🔔 <b>GMB Guard test alert</b>\nIf you can read this, alerts are working.\n${formatUtc(new Date())}`;
  return dispatch(
    text,
    {
      subject: '🔔 GMB Guard test alert',
      html: '<p><b>GMB Guard test alert</b><br>If you can read this, alerts are working.</p>',
      text: 'GMB Guard test alert. If you can read this, alerts are working.',
    },
    extraRecipients,
  );
}
