/** Role from Supabase profiles — sole source of truth for access checks. */
export function resolveDisplayRole(profileRole?: string | null): string | undefined {
  return profileRole ?? undefined;
}

export function isAdminUser(profileRole?: string | null): boolean {
  return profileRole === 'admin';
}
