import { alertLogs } from '@/lib/db';
import { enforceRateLimit, handleRouteError, jsonOk } from '@/lib/api-utils';
import { sendTestAlert } from '@/lib/notifications';
import { getAppSettings } from '@/lib/settings';
import { requireAuth } from '@/lib/session';

/** POST /api/settings/test-alert — send a test message on every configured channel. */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    requireAuth(req);
    enforceRateLimit(req, 'test-alert', 3, 60_000);
    const settings = getAppSettings();
    const result = await sendTestAlert(settings.extraEmailRecipients);

    for (const ch of result.channels) {
      if (ch.status === 'skipped') continue;
      alertLogs.create({
        listingId: null,
        channel: ch.channel,
        status: ch.status === 'sent' ? 'SENT' : 'FAILED',
        recipient: ch.recipient,
        event: 'TEST',
        previousStatus: null,
        newStatus: null,
        error: ch.error,
      });
    }

    return jsonOk(result);
  } catch (err) {
    return handleRouteError(err, 'POST /api/settings/test-alert');
  }
}
