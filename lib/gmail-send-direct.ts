/**
 * Sends an email directly to the Gmail API from the mobile app,
 * bypassing the Next.js backend entirely.
 *
 * Needed because the Next.js/Vercel route handler body limit (~4.5 MB)
 * is hit when sending base64-encoded attachments as JSON.
 * Here, file bytes stay on device until they go straight to Gmail.
 */

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const ALT_BOUNDARY = '----=_PlaceAlt_001';
const MIXED_BOUNDARY = '----=_PlaceMixed_001';

function toBase64Url(str: string): string {
  // btoa works on ASCII; encode as UTF-8 first via percent-encoding trick
  const bytes = encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
  return btoa(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

export interface DirectSendAttachment {
  filename: string;
  mimeType: string;
  uri: string;
  base64Data?: string; // pre-read — if present, skips the read step
}

export interface DirectSendOptions {
  accessToken: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  textBody: string;
  threadId?: string;
  inReplyToMessageId?: string;
  attachments?: DirectSendAttachment[];
}

/**
 * Mark a thread as read by removing the UNREAD label from all its messages.
 * Calls Gmail API directly so we don't depend on backend gmail.modify scope state.
 */
export async function markThreadReadDirectly(
  accessToken: string,
  threadId: string
): Promise<void> {
  const url = `${GMAIL_API}/threads/${encodeURIComponent(threadId)}/modify`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gmail mark-read failed (${res.status}): ${text}`);
  }
}

/**
 * Fetch a Gmail attachment's bytes directly from Gmail API (returns base64).
 * Used when re-saving a draft that already has saved attachments.
 */
export async function fetchAttachmentBase64Directly(
  accessToken: string,
  messageId: string,
  attachmentId: string
): Promise<string> {
  const url = `${GMAIL_API}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gmail attachment fetch failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as { data?: string };
  if (!data.data) throw new Error('Gmail attachment: no data returned');
  // Gmail returns base64url — convert to standard base64 for embedding in MIME
  return data.data.replace(/-/g, '+').replace(/_/g, '/');
}

export async function readFileAsBase64(uri: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', uri);
    xhr.responseType = 'blob';
    xhr.onload = () => {
      const blob: Blob = xhr.response;
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const b64 = result.includes(',') ? result.split(',')[1] : result;
        resolve(b64);
      };
      reader.onerror = () => reject(new Error('FileReader failed'));
      reader.readAsDataURL(blob);
    };
    xhr.onerror = () => reject(new Error('Network error reading file'));
    xhr.send();
  });
}

function buildMime(
  plainText: string,
  attachments: Array<{ filename: string; mimeType: string; base64Data: string }>
): { contentType: string; body: string } {
  const htmlBody = `<div style="font-family:sans-serif;font-size:14px;line-height:1.6">${escapeHtml(plainText)}</div>`;

  const altPart = [
    `--${ALT_BOUNDARY}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    plainText,
    `--${ALT_BOUNDARY}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    htmlBody,
    `--${ALT_BOUNDARY}--`,
  ].join('\r\n');

  if (attachments.length === 0) {
    return {
      contentType: `multipart/alternative; boundary="${ALT_BOUNDARY}"`,
      body: altPart,
    };
  }

  const parts: string[] = [
    `--${MIXED_BOUNDARY}`,
    `Content-Type: multipart/alternative; boundary="${ALT_BOUNDARY}"`,
    '',
    altPart,
  ];

  for (const att of attachments) {
    parts.push(
      `--${MIXED_BOUNDARY}`,
      `Content-Type: ${att.mimeType}; name="${att.filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${att.filename}"`,
      '',
      att.base64Data
    );
  }
  parts.push(`--${MIXED_BOUNDARY}--`);

  return {
    contentType: `multipart/mixed; boundary="${MIXED_BOUNDARY}"`,
    body: parts.join('\r\n'),
  };
}

export async function sendMailDirectly(
  opts: DirectSendOptions
): Promise<{ id: string; threadId: string }> {
  const { accessToken } = opts;

  // Resolve In-Reply-To / References for replies
  let inReplyTo = '';
  let references = '';
  let subject = opts.subject;

  if (opts.inReplyToMessageId) {
    try {
      const url = `${GMAIL_API}/messages/${encodeURIComponent(opts.inReplyToMessageId)}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=Subject&metadataHeaders=References`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (res.ok) {
        const meta = await res.json();
        const headers: Array<{ name: string; value: string }> = meta.payload?.headers ?? [];
        const get = (name: string) =>
          headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
        const mid = get('Message-ID');
        const sub = get('Subject');
        const ref = get('References');
        if (mid) inReplyTo = mid;
        if (sub && subject.trim() === '') subject = /^Re:\s/i.test(sub) ? sub : `Re: ${sub}`;
        if (ref && mid) references = `${ref} ${mid}`.trim();
        else if (mid) references = mid;
      }
    } catch {
      // Non-fatal — send without threading headers if this fails
    }
  }

  // Use pre-read base64 if available, otherwise read now
  const builtAttachments = await Promise.all(
    (opts.attachments ?? []).map(async (a) => ({
      filename: a.filename,
      mimeType: a.mimeType,
      base64Data: a.base64Data ?? await readFileAsBase64(a.uri),
    }))
  );

  const { contentType, body: mimeBody } = buildMime(opts.textBody, builtAttachments);

  const rawLines: string[] = [
    `To: ${opts.to}`,
    ...(opts.cc ? [`Cc: ${opts.cc}`] : []),
    ...(opts.bcc ? [`Bcc: ${opts.bcc}`] : []),
    `Subject: ${(subject || '').trim() || '(no subject)'}`,
    'MIME-Version: 1.0',
    `Content-Type: ${contentType}`,
  ];
  if (inReplyTo) rawLines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) rawLines.push(`References: ${references}`);
  rawLines.push('', mimeBody);

  const raw = toBase64Url(rawLines.join('\r\n'));
  const payload: { raw: string; threadId?: string } = { raw };
  if (opts.threadId) payload.threadId = opts.threadId;

  const res = await fetch(`${GMAIL_API}/messages/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let msg = `Gmail send failed (${res.status})`;
    try { const j = JSON.parse(text); if (j?.error?.message) msg = j.error.message; } catch {}
    throw new Error(msg);
  }

  return res.json();
}

export interface DirectDraftOptions {
  accessToken: string;
  to?: string;
  cc?: string;
  bcc?: string;
  subject: string;
  textBody: string;
  draftId?: string; // if set, update existing draft
  attachments?: DirectSendAttachment[];
}

export async function saveDraftDirectly(
  opts: DirectDraftOptions
): Promise<{ draftId: string }> {
  const { accessToken } = opts;

  const builtAttachments = await Promise.all(
    (opts.attachments ?? []).map(async (a) => ({
      filename: a.filename,
      mimeType: a.mimeType,
      base64Data: a.base64Data ?? await readFileAsBase64(a.uri),
    }))
  );

  const { contentType, body: mimeBody } = buildMime(opts.textBody, builtAttachments);

  const rawLines: string[] = [
    `To: ${opts.to ?? ''}`,
    ...(opts.cc ? [`Cc: ${opts.cc}`] : []),
    ...(opts.bcc ? [`Bcc: ${opts.bcc}`] : []),
    `Subject: ${(opts.subject || '').trim() || '(no subject)'}`,
    'MIME-Version: 1.0',
    `Content-Type: ${contentType}`,
    '',
    mimeBody,
  ];

  const raw = toBase64Url(rawLines.join('\r\n'));
  const message = { raw };

  const url = opts.draftId
    ? `${GMAIL_API}/drafts/${encodeURIComponent(opts.draftId)}`
    : `${GMAIL_API}/drafts`;
  const method = opts.draftId ? 'PUT' : 'POST';

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let msg = `Gmail draft save failed (${res.status})`;
    try { const j = JSON.parse(text); if (j?.error?.message) msg = j.error.message; } catch {}
    throw new Error(msg);
  }

  const data = await res.json() as { id: string };
  return { draftId: data.id };
}
