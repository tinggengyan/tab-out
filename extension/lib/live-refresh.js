/* ================================================================
   Tab Out — keep the open-tabs view in step with the browser

   Tab events come in bursts (restoring a session fires hundreds), and
   the dashboard animates its own closes. request() coalesces events into
   at most one render per delay; later events never push that render
   back. It waits while the page is busy, skips while the page is hidden,
   and flush() catches up when the page is shown again.
   ================================================================ */
(function initLiveRefresh(globalScope) {
  'use strict';

  function createRefreshScheduler({
    render,
    delayMs = 200,
    isBusy = () => false,
    isHidden = () => false,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    onError = () => {},
  }) {
    let scheduled = false;
    let running = false;
    let pending = false;

    function schedule(ms) {
      if (scheduled || running) return;
      scheduled = true;
      setTimer(fire, ms);
    }

    async function fire() {
      scheduled = false;
      if (!pending || isHidden()) return; // flush() picks it up once visible
      if (isBusy()) { schedule(delayMs); return; }
      pending = false;
      running = true;
      try { await render(); } catch (error) { onError(error); }
      finally {
        running = false;
        if (pending) schedule(delayMs);
      }
    }

    function request() {
      pending = true;
      schedule(delayMs);
    }

    function flush() {
      if (pending) schedule(0);
    }

    return { request, flush };
  }

  const api = { createRefreshScheduler };
  globalScope.TabOutLib = Object.assign(globalScope.TabOutLib || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
