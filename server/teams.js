// Teams preview for VMM CRM escalation emails.
// Mirrors the LOTS CRM approach: a Power Automate "post to a channel when a
// webhook request is received" link is kept in a private secrets file as
// TEAMS_WEBHOOK_URL. The signed link is never exposed to the browser.
// Teams cards cannot contain HTML, so the email is rendered as an Adaptive Card.

const MAX_LINES = 60;

const text = (t, extra = {}) => ({
  type: 'TextBlock',
  text: String(t ?? ''),
  wrap: true,
  ...extra,
});

export function configured(url = '') {
  const value = String(url || '').trim();
  return /^https:\/\//.test(value) || /^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(value);
}

async function sendAdaptiveCard(url, body) {
  if (!configured(url)) throw new Error('Teams is not connected (TEAMS_WEBHOOK_URL is not set)');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'message',
      attachments: [{
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          msteams: { width: 'Full' },
          body,
        },
      }],
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Teams returned ${res.status} ${res.statusText}`.trim());
  return true;
}

/** Post a simple Adaptive Card (title, facts, text lines). */
export async function postCard(url, { title, subtitle = '', facts = [], lines = [] }) {
  const shown = lines.slice(0, MAX_LINES);
  const body = [
    text(title, { weight: 'Bolder', size: 'Medium', spacing: 'None' }),
    ...(subtitle ? [text(subtitle, { isSubtle: true, spacing: 'None' })] : []),
    ...(facts.length
      ? [{
          type: 'FactSet',
          spacing: 'Medium',
          facts: facts
            .filter(([, value]) => value !== '' && value != null)
            .map(([name, value]) => ({ title: name, value: String(value).slice(0, 500) })),
        }]
      : []),
    ...(shown.length
      ? [{
          type: 'Container',
          style: 'emphasis',
          separator: true,
          items: shown.map((line, i) => text(line.trim() ? line.slice(0, 1000) : ' ', { spacing: i ? 'None' : 'Default' })),
        }]
      : []),
    ...(lines.length > MAX_LINES
      ? [text(`… ${lines.length - MAX_LINES} more line(s)`, { isSubtle: true })]
      : []),
  ];
  return sendAdaptiveCard(url, body);
}

/** One escalation email as a Teams preview card. Nothing is emailed. */
export async function postEmailPreview(url, {
  kind = 'Escalation',
  to = '',
  cc = '',
  subject = '',
  lines = [],
  facts = [],
  sample = false,
  footer = 'Open Mind Services Limited · VMM CRM · DEMO — NOT SENT',
}) {
  const body = [
    text(`👁️ EMAIL PREVIEW — NOT SENT${sample ? ' · SAMPLE' : ''}`, {
      size: 'Small',
      weight: 'Bolder',
      color: 'Warning',
      spacing: 'None',
    }),
    {
      type: 'FactSet',
      spacing: 'Medium',
      facts: [
        ['Type', kind],
        ['To', to || '(no address set)'],
        ['Cc', cc],
        ['Subject', subject],
        ...facts,
      ]
        .filter(([, value]) => value !== '' && value != null)
        .map(([name, value]) => ({ title: name, value: String(value).slice(0, 500) })),
    },
    {
      type: 'Container',
      style: 'attention',
      bleed: false,
      spacing: 'Medium',
      items: [
        text('VMM FACILITY MANAGEMENT', { size: 'Small', weight: 'Bolder', spacing: 'None' }),
        text('Escalation mail preview', { size: 'Medium', weight: 'Bolder', spacing: 'None' }),
      ],
    },
    {
      type: 'Container',
      spacing: 'Small',
      items: lines.slice(0, 80).map((line, i) => text(line.trim() ? line.slice(0, 1000) : ' ', { spacing: i ? 'None' : 'Default' })),
    },
    {
      type: 'Container',
      style: 'emphasis',
      spacing: 'Medium',
      separator: true,
      items: [text(footer, { size: 'Small', isSubtle: true })],
    },
  ];
  return sendAdaptiveCard(url, body);
}
