/**
 * Group-related types and constants shared across all apps.
 */

/** Supported group types. Currently only 'family' — may expand in future. */
export const GROUP_TYPES = ['family'] as const;
export type GroupType = (typeof GROUP_TYPES)[number];

/** Roles a user can hold within a group. */
export const GROUP_ROLES = ['admin', 'member'] as const;
export type GroupRole = (typeof GROUP_ROLES)[number];

/** Number of days a group invite token remains valid after creation. */
export const INVITE_TOKEN_EXPIRY_DAYS = 7;
