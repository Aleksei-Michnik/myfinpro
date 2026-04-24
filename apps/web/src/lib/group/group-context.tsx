'use client';

import type { GroupRole } from '@myfinpro/shared';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type {
  CreateGroupData,
  GroupDetail,
  GroupSummary,
  InviteInfo,
  UpdateGroupData,
} from './types';
import { useAuth } from '@/lib/auth/auth-context';

export interface InviteCreatedResult {
  token: string;
  expiresAt: string;
  inviteUrl: string;
}

interface GroupContextType {
  groups: GroupSummary[];
  isLoading: boolean;
  fetchGroups: () => Promise<void>;
  getGroup: (groupId: string) => Promise<GroupDetail>;
  refreshGroup: (groupId: string) => Promise<GroupDetail>;
  createGroup: (data: CreateGroupData) => Promise<GroupSummary>;
  updateGroup: (groupId: string, data: UpdateGroupData) => Promise<GroupSummary>;
  deleteGroup: (groupId: string) => Promise<void>;
  getInviteInfo: (token: string) => Promise<InviteInfo>;
  acceptInvite: (token: string) => Promise<GroupSummary>;
  createInvite: (groupId: string) => Promise<InviteCreatedResult>;
  updateMemberRole: (groupId: string, userId: string, role: GroupRole) => Promise<void>;
  removeMember: (groupId: string, userId: string) => Promise<void>;
}

/**
 * Parse a fetch response error payload and throw an Error with an optional
 * `.errorCode` property so callers can differentiate specific failure modes.
 */
async function throwApiError(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as {
    message?: string;
    errorCode?: string;
  };
  const err = new Error(body.message || fallback) as Error & { errorCode?: string };
  if (body.errorCode) {
    err.errorCode = body.errorCode;
  }
  throw err;
}

const GroupContext = createContext<GroupContextType | undefined>(undefined);

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api/v1';

export function GroupProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, getAccessToken } = useAuth();
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchGroups = useCallback(async () => {
    const token = getAccessToken();
    if (!token) {
      setGroups([]);
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/groups`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        throw new Error('Failed to fetch groups');
      }
      const data: GroupSummary[] = await res.json();
      setGroups(data);
    } catch {
      // Silent fail — caller can re-trigger
      setGroups([]);
    } finally {
      setIsLoading(false);
    }
  }, [getAccessToken]);

  const getGroup = useCallback(
    async (groupId: string): Promise<GroupDetail> => {
      const token = getAccessToken();
      if (!token) throw new Error('Not authenticated');
      const res = await fetch(`${API_BASE}/groups/${encodeURIComponent(groupId)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        await throwApiError(res, 'Failed to load group');
      }
      return (await res.json()) as GroupDetail;
    },
    [getAccessToken],
  );

  const refreshGroup = useCallback((groupId: string) => getGroup(groupId), [getGroup]);

  const createGroup = useCallback(
    async (data: CreateGroupData) => {
      const token = getAccessToken();
      if (!token) throw new Error('Not authenticated');
      const res = await fetch(`${API_BASE}/groups`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ message: 'Failed to create group' }));
        throw new Error((error as { message?: string }).message || 'Failed to create group');
      }
      const group: GroupSummary = await res.json();
      setGroups((prev) => [...prev, group]);
      return group;
    },
    [getAccessToken],
  );

  const updateGroup = useCallback(
    async (groupId: string, data: UpdateGroupData) => {
      const token = getAccessToken();
      if (!token) throw new Error('Not authenticated');
      const res = await fetch(`${API_BASE}/groups/${groupId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        await throwApiError(res, 'Failed to update group');
      }
      const group: GroupSummary = await res.json();
      setGroups((prev) => prev.map((g) => (g.id === groupId ? group : g)));
      return group;
    },
    [getAccessToken],
  );

  const deleteGroup = useCallback(
    async (groupId: string) => {
      const token = getAccessToken();
      if (!token) throw new Error('Not authenticated');
      const res = await fetch(`${API_BASE}/groups/${groupId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        await throwApiError(res, 'Failed to delete group');
      }
      setGroups((prev) => prev.filter((g) => g.id !== groupId));
    },
    [getAccessToken],
  );

  const getInviteInfo = useCallback(
    async (inviteToken: string): Promise<InviteInfo> => {
      const token = getAccessToken();
      if (!token) throw new Error('Not authenticated');
      const res = await fetch(`${API_BASE}/groups/invite/${encodeURIComponent(inviteToken)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        await throwApiError(res, 'Failed to load invite');
      }
      return (await res.json()) as InviteInfo;
    },
    [getAccessToken],
  );

  const acceptInvite = useCallback(
    async (inviteToken: string): Promise<GroupSummary> => {
      const token = getAccessToken();
      if (!token) throw new Error('Not authenticated');
      const res = await fetch(
        `${API_BASE}/groups/invite/${encodeURIComponent(inviteToken)}/accept`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        },
      );
      if (!res.ok) {
        await throwApiError(res, 'Failed to accept invite');
      }
      const group = (await res.json()) as GroupSummary;
      // Refresh group list so the newly joined group appears
      await fetchGroups();
      return group;
    },
    [getAccessToken, fetchGroups],
  );

  const createInvite = useCallback(
    async (groupId: string): Promise<InviteCreatedResult> => {
      const token = getAccessToken();
      if (!token) throw new Error('Not authenticated');
      const res = await fetch(`${API_BASE}/groups/${encodeURIComponent(groupId)}/invites`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        await throwApiError(res, 'Failed to generate invite');
      }
      const body = (await res.json()) as {
        token: string;
        expiresAt: string;
        inviteUrl?: string;
      };
      const origin =
        typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';
      let inviteUrl: string;
      if (body.inviteUrl) {
        // Backend may return a path-only URL — prepend origin if so.
        inviteUrl = body.inviteUrl.startsWith('http')
          ? body.inviteUrl
          : `${origin}${body.inviteUrl}`;
      } else {
        inviteUrl = `${origin}/groups/invite/${encodeURIComponent(body.token)}`;
      }
      return {
        token: body.token,
        expiresAt: body.expiresAt,
        inviteUrl,
      };
    },
    [getAccessToken],
  );

  const updateMemberRole = useCallback(
    async (groupId: string, userId: string, role: GroupRole): Promise<void> => {
      const token = getAccessToken();
      if (!token) throw new Error('Not authenticated');
      const res = await fetch(
        `${API_BASE}/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ role }),
        },
      );
      if (!res.ok) {
        await throwApiError(res, 'Failed to update member role');
      }
    },
    [getAccessToken],
  );

  const removeMember = useCallback(
    async (groupId: string, userId: string): Promise<void> => {
      const token = getAccessToken();
      if (!token) throw new Error('Not authenticated');
      const res = await fetch(
        `${API_BASE}/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`,
        {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        },
      );
      if (!res.ok) {
        await throwApiError(res, 'Failed to remove member');
      }
    },
    [getAccessToken],
  );

  // Auto-fetch groups when the user becomes authenticated
  useEffect(() => {
    if (isAuthenticated) {
      fetchGroups();
    } else {
      setGroups([]);
    }
  }, [isAuthenticated, fetchGroups]);

  return (
    <GroupContext.Provider
      value={{
        groups,
        isLoading,
        fetchGroups,
        getGroup,
        refreshGroup,
        createGroup,
        updateGroup,
        deleteGroup,
        getInviteInfo,
        acceptInvite,
        createInvite,
        updateMemberRole,
        removeMember,
      }}
    >
      {children}
    </GroupContext.Provider>
  );
}

export function useGroups() {
  const context = useContext(GroupContext);
  if (!context) {
    throw new Error('useGroups must be used within a GroupProvider');
  }
  return context;
}
