// presenter.js — the Presenter conformance SDK (REGISTRY-SPEC §6/§8). Every presenter (.obp)
// includes this ONE script to participate in the Shell's menu system. A presenter is a content leaf:
// it never draws its own menu bar or hamburger — it CONTRIBUTES verbs and the Shell's Menu (the
// active object's File/Edit/View) presents them. This is the IContextMenu / "capabilities advertise
// their own verbs" analog.
//
//   Presenter.menu(scope, items)  — declare/refresh this presenter's menu contributions (posts menu-context).
//   Presenter.onVerb(fn)          — handle a verb the user chose (the Shell posts app-menu-action).
//   Presenter.announce()          — re-post (called automatically on focus/visibility).
//
// items: [{ menu: 'file'|'edit'|'view', verb: 'save', label: 'Save', enabled?: true, checked?: false }]
//
// We own input — no browser/WebView context menu inside a presenter either (the §8 conformance rule).
(function () {
  'use strict';
  var _scope = '', _items = [], _handler = null;

  function post() {
    try { parent.postMessage({ type: 'menu-context', scope: _scope, items: _items }, '*'); } catch (e) { /* not framed */ }
  }
  function menu(scope, items) { if (scope != null) _scope = scope; _items = items || []; post(); }
  function onVerb(fn) { _handler = fn; }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.type !== 'app-menu-action') return;
    if (_handler) { try { _handler(d.verb); } catch (err) { /* presenter handler threw — degrade */ } }
    // Back-compat: android-terminal-era surfaces listen for a DOM CustomEvent.
    try { window.dispatchEvent(new CustomEvent('app-menu-action', { detail: { action: d.verb, verb: d.verb } })); } catch (err) {}
  });

  // Re-announce when (re)focused/shown so the Shell always holds the live menu of the active presenter.
  window.addEventListener('focus', post);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) post(); });
  // We own input — suppress the engine's context menu in every presenter too (§8).
  window.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  // The conformance handle. `Applet` stays as a deprecated alias so an un-migrated surface still
  // contributes its menu (REGISTRY-SPEC §9: retire leaves cleanly, don't break them mid-rename).
  window.Presenter = { menu: menu, onVerb: onVerb, announce: post };
  window.Applet = window.Presenter;
})();
