import type { GmailLabel } from './api';

const TTL_MS = 5 * 60 * 1000;

let labels: GmailLabel[] | null = null;
let fetchedAt = 0;

export function peekGmailLabelsCache(): GmailLabel[] | null {
  if (!labels || Date.now() - fetchedAt >= TTL_MS) return null;
  return labels;
}

export function setGmailLabelsCache(next: GmailLabel[]): void {
  labels = next;
  fetchedAt = Date.now();
}

export function clearGmailLabelsCache(): void {
  labels = null;
  fetchedAt = 0;
}
