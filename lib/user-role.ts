/** Role from Supabase profiles — sole source of truth for access checks. */
export function resolveDisplayRole(profileRole?: string | null): string | undefined {
  return profileRole ?? undefined;
}

/** Sidebar label: admin for admins, access group name for grouped staff, else role. */
export function resolveSidebarRoleLabel(
  profileRole?: string | null,
  groupName?: string | null,
): string | undefined {
  if (profileRole === 'admin') return 'admin';
  const group = groupName?.trim();
  if (group) return group;
  return profileRole ?? undefined;
}

export function isAdminUser(profileRole?: string | null): boolean {
  return profileRole === 'admin';
}
