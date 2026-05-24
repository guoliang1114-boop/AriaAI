import '@testing-library/jest-dom/vitest'

// Node v25+ ships a built-in localStorage stub that lacks setItem/getItem/clear.
// jsdom picks it up instead of providing its own full implementation.
const _store = new Map<string, string>()

const storagePolyfill: Storage = {
  get length() { return _store.size },
  clear() { _store.clear() },
  getItem(key: string) { return _store.get(key) ?? null },
  key(index: number) { return Array.from(_store.keys())[index] ?? null },
  removeItem(key: string) { _store.delete(key) },
  setItem(key: string, value: string) { _store.set(key, String(value)) },
}

if (typeof window !== 'undefined') {
  try {
    window.localStorage.setItem('__test__', '1')
    window.localStorage.removeItem('__test__')
  } catch {
    Object.defineProperty(window, 'localStorage', {
      value: storagePolyfill,
      writable: true,
      configurable: true,
    })
  }

  // Polyfill matchMedia for jsdom
  if (!window.matchMedia) {
    window.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })
  }
}
