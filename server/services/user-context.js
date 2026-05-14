import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

export function runWithUser(user, fn) {
  return storage.run({ user }, fn);
}

export function getCurrentUser() {
  return storage.getStore()?.user || null;
}
