// One shared object of "what the supervisor is looking at", with a way to be told when it changes.
export function createStore(initial) {
  let state = { ...initial };
  const subscribers = new Set();
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...patch };
      subscribers.forEach((fn) => fn(state, patch));
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}
