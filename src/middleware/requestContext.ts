import { AsyncLocalStorage } from 'node:async_hooks';
// Import Container using both named and default exports
// In typedi ESM, both exports reference the same Container class
import * as TypeDI from 'typedi';

type Store = Map<string, unknown>;

const als = new AsyncLocalStorage<Store>();

export const RequestContext = {
  run<T>(fn: () => T) {
    const store = new Map<string, unknown>();
    return als.run(store, fn);
  },
  set<T = unknown>(key: string, value: T) {
    const store = als.getStore();
    if (store) {
      store.set(key, value);
    }
  },
  get<T = unknown>(key: string): T | undefined {
    const store = als.getStore();
    return (store?.get(key) as T) ?? undefined;
  },
  has(key: string): boolean {
    const store = als.getStore();
    return store ? store.has(key) : false;
  },
};

// Get the Container from the module namespace
// This ensures we patch the actual Container class regardless of how it's imported elsewhere
const Container = TypeDI.Container || TypeDI.default;

if (!Container || typeof Container.get !== 'function') {
  throw new Error('[RequestContext] Failed to import Container from typedi');
}

const origGet = Container.get.bind(Container) as <T = unknown>(someClass: any) => T;
const origSet = Container.set.bind(Container) as (serviceIdentifier: any, value: any) => void;

// Patch the Container's get method
(Container as any).get = function patchedGet<T = unknown>(token: any): T {
  if (typeof token === 'string' && RequestContext.has(token)) {
    return RequestContext.get<T>(token) as T;
  }
  return origGet<T>(token);
};

// Patch the Container's set method
(Container as any).set = function patchedSet(serviceIdentifier: any, value: any) {
  if (typeof serviceIdentifier === 'string' && als.getStore()) {
    RequestContext.set(serviceIdentifier, value);
    return Container;
  }
  return origSet(serviceIdentifier, value);
};

// Also patch the default export if it exists and is different
if (TypeDI.default && TypeDI.default !== Container) {
  TypeDI.default.get = Container.get;
  TypeDI.default.set = Container.set;
}

// Re-export Container to ensure consistency
export { Container };

export function requestContextMiddleware(req: any, res: any, next: (err?: any) => void) {
  RequestContext.run(() => {
    RequestContext.set('req', req);
    RequestContext.set('res', res);
    next();
  });
}
