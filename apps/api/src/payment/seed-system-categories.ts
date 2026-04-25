import { PrismaClient } from '@prisma/client';
import { DEFAULT_CATEGORIES } from '@myfinpro/shared';

/**
 * Idempotently upsert all system-owned default categories.
 * Safe to call from: `prisma db seed`, integration test setup, API bootstrap.
 *
 * Uniqueness is enforced by the DB on (owner_type, owner_id, slug, direction).
 * `owner_id` is NULL for system categories, so `prisma.upsert` on the composite
 * unique can be unreliable on MySQL — we use `findFirst` + `create`/`update`
 * to keep behaviour predictable and portable.
 *
 * Returns a map of `direction:slug` → id for callers that need references.
 */
export async function seedSystemCategories(
  prisma: Pick<PrismaClient, 'category'>,
): Promise<Map<string, string>> {
  const ownerType = 'system';
  const results = new Map<string, string>();

  for (const def of DEFAULT_CATEGORIES) {
    const existing = await prisma.category.findFirst({
      where: {
        ownerType,
        ownerId: null,
        slug: def.slug,
        direction: def.direction,
      },
    });

    if (existing) {
      // Refresh display fields (name/icon/color) in case defaults were refined
      // between deploys. Uniqueness keys (slug/direction/owner) are immutable.
      const updated = await prisma.category.update({
        where: { id: existing.id },
        data: {
          name: def.name,
          icon: def.icon ?? null,
          color: def.color ?? null,
          isSystem: true,
        },
      });
      results.set(`${def.direction}:${def.slug}`, updated.id);
    } else {
      const created = await prisma.category.create({
        data: {
          slug: def.slug,
          name: def.name,
          direction: def.direction,
          icon: def.icon ?? null,
          color: def.color ?? null,
          ownerType,
          ownerId: null,
          isSystem: true,
        },
      });
      results.set(`${def.direction}:${def.slug}`, created.id);
    }
  }

  return results;
}
