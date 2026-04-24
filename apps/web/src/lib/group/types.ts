/**
 * Group-related frontend types.
 * Mirrors the shape returned by the API (see apps/api/src/group).
 */

export interface GroupSummary {
  id: string;
  name: string;
  type: string;
  defaultCurrency: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
  role?: string;
}

export interface GroupMember {
  id: string;
  name: string;
  email: string;
  role: string;
  joinedAt: string;
}

export interface GroupDetail extends GroupSummary {
  members: GroupMember[];
}

export interface CreateGroupData {
  name: string;
  type?: string;
  defaultCurrency?: string;
}

export interface UpdateGroupData {
  name?: string;
  type?: string;
  defaultCurrency?: string;
}

export interface InviteInfo {
  groupId: string;
  groupName: string;
  groupType: string;
  inviterName: string;
}
