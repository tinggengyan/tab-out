(function initSnapshotService(globalScope) {
  'use strict';
  function createSnapshotService({ captureAll, repository, delayMs = 15000, setTimer, clearTimer, onCaptured }) {
    if (!captureAll || !repository?.add) throw new TypeError('Snapshot service dependencies are required');
    const schedule = setTimer || ((fn, delay) => setTimeout(fn, delay));
    const cancel = clearTimer || (timer => clearTimeout(timer));
    let timer = null;
    let generation = 0;
    let queue = Promise.resolve();

    async function perform(type) {
      const session = await captureAll(type);
      const stored = await repository.add(session);
      if (stored && onCaptured) await onCaptured(session);
      return { stored, sessionId: session.id };
    }

    function flush(type = 'automatic') {
      if (timer !== null) {
        cancel(timer);
        timer = null;
      }
      const run = queue.then(() => perform(type));
      queue = run.catch(() => {});
      return run;
    }

    function markDirty(reason = 'unknown') {
      generation += 1;
      const expected = generation;
      if (timer !== null) cancel(timer);
      timer = schedule(async () => {
        if (expected !== generation) return { stored: false, stale: true };
        timer = null;
        return flush('automatic');
      }, delayMs);
      return { reason, generation };
    }

    return { markDirty, flush };
  }
  const api = { createSnapshotService };
  globalScope.TabOutCore = Object.assign(globalScope.TabOutCore || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
