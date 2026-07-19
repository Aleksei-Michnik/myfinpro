import '@testing-library/jest-dom';

// Node 26 defines a bare `localStorage` global that stays `undefined` unless
// the process is started with --localstorage-file, and because the key
// already exists on globalThis, jsdom's implementation never gets populated
// into the test realm (window === globalThis there). Give tests a real
// in-memory Storage instead; window.localStorage resolves to the same object.
function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(String(key)) ?? null,
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => {
      store.delete(String(key));
    },
    setItem: (key: string, value: string) => {
      store.set(String(key), String(value));
    },
  } as Storage;
}

Object.defineProperty(globalThis, 'localStorage', {
  value: memoryStorage(),
  writable: true,
  configurable: true,
});
