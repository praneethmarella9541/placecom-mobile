/** Team admin types — aligned with placecom web `/api/admin/team-members`. */

export type AdminTeamGroup = {
  id: string;
  name: string;
  restrictedFeatures: string[];
  createdAt?: string;
};

export type AdminTeamMember = {
  id: string;
  email: string | null;
  displayUsername: string | null;
  jobTitle: string | null;
  bio: string | null;
  role: string;
  restrictedFeatures: string[];
  mobilePhone: string | null;
  exotelVirtualNumber: string | null;
  groupId: string | null;
  groupName: string | null;
  openaiTokenLimit: number | null;
  tokensUsed: number;
};

export function normalizeAdminTeamMember(raw: Record<string, unknown>): AdminTeamMember {
  return {
    id: String(raw.id ?? ''),
    email: (raw.email as string | null) ?? null,
    displayUsername:
      (raw.displayUsername as string | null) ??
      (raw.display_username as string | null) ??
      null,
    jobTitle: (raw.jobTitle as string | null) ?? (raw.job_title as string | null) ?? null,
    bio: (raw.bio as string | null) ?? null,
    role: String(raw.role ?? 'staff'),
    restrictedFeatures:
      (raw.restrictedFeatures as string[] | undefined) ??
      (raw.restricted_features as string[] | undefined) ??
      [],
    mobilePhone:
      (raw.mobilePhone as string | null) ?? (raw.mobile_phone as string | null) ?? null,
    exotelVirtualNumber:
      (raw.exotelVirtualNumber as string | null) ??
      (raw.exotel_virtual_number as string | null) ??
      null,
    groupId: (raw.groupId as string | null) ?? (raw.group_id as string | null) ?? null,
    groupName: (raw.groupName as string | null) ?? (raw.group_name as string | null) ?? null,
    openaiTokenLimit:
      raw.openaiTokenLimit != null
        ? Number(raw.openaiTokenLimit) || null
        : raw.openai_token_limit != null
          ? Number(raw.openai_token_limit) || null
          : null,
    tokensUsed: Number(raw.tokensUsed ?? raw.tokens_used ?? 0) || 0,
  };
}

export function teamMemberLabel(member: AdminTeamMember): string {
  return member.displayUsername?.trim() || member.email?.trim() || member.id;
}

export function teamMemberSubtitle(member: AdminTeamMember): string {
  const parts: string[] = [];
  if (member.email) parts.push(member.email);
  parts.push(member.groupName?.trim() || 'Full access');
  if (member.openaiTokenLimit != null) {
    parts.push(
      `${member.tokensUsed.toLocaleString()}/${member.openaiTokenLimit.toLocaleString()} tokens`
    );
  }
  return parts.join(' · ');
}
