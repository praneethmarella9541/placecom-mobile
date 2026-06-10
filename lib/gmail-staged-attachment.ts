/**
 * Tier 2 attachment upload (3 MB < size ≤ 25 MB).
 *
 * Files in this range are too large to safely base64-encode in a single JSON
 * POST (server rejects >4 MB JSON bodies with 413).  Instead we split them
 * into 4 MB chunks, POST each chunk to /api/gmail/drafts/attachment-chunk,
 * and receive an `uploadId`.  The draft-save API then embeds the staged file
 * as a real Gmail MIME attachment via `stagedUploadIds`.
 */

import { BASE_URL } from './api';
import { supabase } from './supabase';
import { readFileAsBase64 } from './gmail-send-direct';

const CHUNK_BYTES = 4 * 1024 * 1024; // 4 MB per chunk

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `POST ${path} failed: ${res.status}`;
    try { const b = await res.json(); if (b?.error) msg = b.error; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export type StagedUploadProgress = {
  uploadId?: string;
  bytesUploaded: number;
  totalBytes: number;
  done: boolean;
};

/**
 * Upload a file in ≤4 MB base64 chunks to /api/gmail/drafts/attachment-chunk.
 * Calls `onProgress` after each chunk.
 *
 * @returns the `uploadId` to pass as `stagedUploadIds` on draft save.
 */
export async function uploadStagedAttachment(
  file: { uri: string; name: string; mimeType: string; size: number },
  onProgress?: (progress: StagedUploadProgress) => void,
  signal?: AbortSignal
): Promise<string> {
  const totalSize = file.size;

  // Read the entire file as base64 once.
  // Peak memory: ~33 MB for a 25 MB file — acceptable for mobile.
  const fullBase64 = await readFileAsBase64(file.uri);

  // How many base64 chars correspond to CHUNK_BYTES of decoded bytes?
  // base64 is 4 chars per 3 bytes, so chars = ceil(bytes * 4/3).
  const chunkBase64Chars = Math.ceil((CHUNK_BYTES * 4) / 3);

  let uploadId: string | undefined;
  let offset = 0;
  let chunkStart = 0;

  while (offset < totalSize) {
    if (signal?.aborted) throw new DOMException('Upload aborted', 'AbortError');

    const chunkBytes = Math.min(CHUNK_BYTES, totalSize - offset);
    const chunkBase64 = fullBase64.slice(chunkStart, chunkStart + chunkBase64Chars);

    const body: Record<string, unknown> = {
      filename: file.name,
      mimeType: file.mimeType,
      totalSize,
      offset,
      chunk: chunkBase64,
    };
    if (uploadId) body.uploadId = uploadId;

    const res = await postJson<{ uploadId: string; done: boolean; received: number }>(
      '/api/gmail/drafts/attachment-chunk',
      body
    );

    uploadId = res.uploadId;
    offset += chunkBytes;
    chunkStart += chunkBase64Chars;

    onProgress?.({
      uploadId,
      bytesUploaded: Math.min(offset, totalSize),
      totalBytes: totalSize,
      done: res.done,
    });

    if (res.done) break;
  }

  if (!uploadId) throw new Error('Staged upload: no uploadId returned from server');
  return uploadId;
}
