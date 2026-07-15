import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Build a Map-backed mock Storage that honours the subset of the Web Storage
// API our helper uses. Exposed as a factory so individual tests can install
// a throwing variant to exercise the quota-error branch.
interface MockStorage extends Storage {
  __throwOnSet?: boolean;
}
function makeStorage(throwOnSet = false): MockStorage {
  const map = new Map<string, string>();
  const s: Partial<MockStorage> = {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      if (throwOnSet) throw new Error('QuotaExceeded');
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  };
  return s as MockStorage;
}

async function importFresh() {
  // Reset module registry so the helper re-evaluates `window` checks.
  vi.resetModules();
  return await import('../remember');
}

describe('remember.ts — SSR safety', () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    // Restore window after tests that delete it.
    (globalThis as unknown as { window: typeof window }).window = originalWindow;
    vi.restoreAllMocks();
  });

  it('returns defaults when window is undefined (SSR)', async () => {
    // Force the SSR state where `window` is not defined on globalThis.
    delete (globalThis as { window?: Window }).window;
    const mod = await importFresh();
    expect(mod.getLastUsedScopes()).toEqual([{ scope: 'personal' }]);
    expect(mod.getLastUsedDirection()).toBe('OUT');
    expect(mod.getLastUsedType()).toBe('ONE_TIME');
    // Setters are no-ops in SSR — must not throw.
    expect(() => mod.setLastUsedScopes([{ scope: 'personal' }])).not.toThrow();
    expect(() => mod.setLastUsedDirection('IN')).not.toThrow();
    expect(() => mod.setLastUsedType('RECURRING')).not.toThrow();
  });
});

describe('remember.ts — with mocked localStorage', () => {
  let storage: MockStorage;

  beforeEach(() => {
    storage = makeStorage();
    vi.stubGlobal('window', { localStorage: storage });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('returns default scopes when storage is empty', async () => {
    const { getLastUsedScopes } = await importFresh();
    expect(getLastUsedScopes()).toEqual([{ scope: 'personal' }]);
  });

  it('round-trips scopes verbatim', async () => {
    const { getLastUsedScopes, setLastUsedScopes } = await importFresh();
    const input = [{ scope: 'personal' }, { scope: 'group', groupId: 'g-1' }] as const;
    setLastUsedScopes([...input]);
    expect(getLastUsedScopes()).toEqual(input);
  });

  it('returns default when stored JSON is corrupt', async () => {
    storage.setItem('myfin.transaction.lastScopes', '{not json');
    const { getLastUsedScopes } = await importFresh();
    expect(getLastUsedScopes()).toEqual([{ scope: 'personal' }]);
  });

  it('returns default when stored value is an empty array', async () => {
    storage.setItem('myfin.transaction.lastScopes', '[]');
    const { getLastUsedScopes } = await importFresh();
    expect(getLastUsedScopes()).toEqual([{ scope: 'personal' }]);
  });

  it('filters out invalid group entries missing groupId', async () => {
    storage.setItem(
      'myfin.transaction.lastScopes',
      JSON.stringify([{ scope: 'group' }, { scope: 'personal' }]),
    );
    const { getLastUsedScopes } = await importFresh();
    expect(getLastUsedScopes()).toEqual([{ scope: 'personal' }]);
  });

  it('returns default when all entries are invalid', async () => {
    storage.setItem(
      'myfin.transaction.lastScopes',
      JSON.stringify([{ scope: 'nonsense' }, null, 42]),
    );
    const { getLastUsedScopes } = await importFresh();
    expect(getLastUsedScopes()).toEqual([{ scope: 'personal' }]);
  });

  it('round-trips direction', async () => {
    const { getLastUsedDirection, setLastUsedDirection } = await importFresh();
    setLastUsedDirection('IN');
    expect(getLastUsedDirection()).toBe('IN');
    setLastUsedDirection('OUT');
    expect(getLastUsedDirection()).toBe('OUT');
  });

  it('returns default direction for an invalid stored value', async () => {
    storage.setItem('myfin.transaction.lastDirection', 'SIDEWAYS');
    const { getLastUsedDirection } = await importFresh();
    expect(getLastUsedDirection()).toBe('OUT');
  });

  it('round-trips every valid transaction type', async () => {
    const { getLastUsedType, setLastUsedType } = await importFresh();
    const types = [
      'ONE_TIME',
      'RECURRING',
      'LIMITED_PERIOD',
      'INSTALLMENT',
      'LOAN',
      'MORTGAGE',
    ] as const;
    for (const t of types) {
      setLastUsedType(t);
      expect(getLastUsedType()).toBe(t);
    }
  });

  it('returns default type for an invalid stored value', async () => {
    storage.setItem('myfin.transaction.lastType', 'GARBAGE');
    const { getLastUsedType } = await importFresh();
    expect(getLastUsedType()).toBe('ONE_TIME');
  });

  it('silently swallows quota errors in setters', async () => {
    const throwing = makeStorage(true);
    vi.stubGlobal('window', { localStorage: throwing });
    const { setLastUsedScopes, setLastUsedDirection, setLastUsedType } = await importFresh();
    expect(() => setLastUsedScopes([{ scope: 'personal' }])).not.toThrow();
    expect(() => setLastUsedDirection('IN')).not.toThrow();
    expect(() => setLastUsedType('RECURRING')).not.toThrow();
  });

  it('returns defaults when accessing localStorage throws', async () => {
    vi.stubGlobal('window', {
      get localStorage(): Storage {
        throw new Error('blocked');
      },
    });
    const { getLastUsedScopes, getLastUsedDirection, getLastUsedType } = await importFresh();
    expect(getLastUsedScopes()).toEqual([{ scope: 'personal' }]);
    expect(getLastUsedDirection()).toBe('OUT');
    expect(getLastUsedType()).toBe('ONE_TIME');
  });
});
