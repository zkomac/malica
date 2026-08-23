// Malica ↔ Wolt — vse teče v TVOJEM brskalniku, vsakič sproti:
// prebere Woltovo sejo (__wrtoken), pridobi seznam jedi iz Malice in napolni
// Wolt košarico. Noben žeton se ne shrani in ne zapusti tega računalnika.
const MALICA = "https://malica.stavio.net";
const WOLT_AUTH = "https://authentication.wolt.com/v1/wauth2/access_token";
const clientId = crypto.randomUUID();

function woltHeaders(token, json) {
  const h = {
    "app-language": "sl", "platform": "Web",
    "client-version": "1.16.79", "clientversionnumber": "1.16.79",
    "w-wolt-session-id": "no-analytics-consent", "x-wolt-web-clientid": clientId,
    "accept": "application/json"
  };
  if (json) h["content-type"] = "application/json";
  if (token) h["authorization"] = "Bearer " + token;
  return h;
}

function unwrap(raw) {
  let t = String(raw || "").trim();
  for (let i = 0; i < 6; i++) {
    const prev = t;
    if (t.startsWith('"') && t.endsWith('"') && t.length > 1) t = t.slice(1, -1);
    if (/%[0-9A-Fa-f]{2}/.test(t)) { try { t = decodeURIComponent(t); } catch (e) {} }
    if (t === prev) break;
  }
  return t;
}

async function woltRefreshCookie() {
  const all = await chrome.cookies.getAll({ domain: "wolt.com" });
  const c = all.find((x) => x.name === "__wrtoken");
  return c ? unwrap(c.value) : null;
}

async function malica(path) {
  const r = await fetch(MALICA + path, { credentials: "include" });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error("Nisi prijavljen v Malico (vpiši PIN)");
  if (!r.ok) throw new Error(j.error || "Malica: napaka " + r.status);
  return j;
}

// Zapiše dogodek razširitve v dnevnik skupine v Malici (viden v adminu). Nikoli ne vrže napake.
async function extlog(who, ok, text) {
  try { await fetch(MALICA + "/api/wolt/extlog", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ who, ok, text }) }); } catch (e) {}
}

async function woltAccessToken(refresh) {
  const r = await fetch(WOLT_AUTH, {
    method: "POST",
    headers: { ...woltHeaders(), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh })
  });
  if (!r.ok) throw new Error("Wolt je zavrnil prijavo (HTTP " + r.status + ") — odjavi se in znova prijavi na wolt.com");
  const j = await r.json();
  const access = j.access_token || j.accessToken;
  if (!access) throw new Error("Wolt ni vrnil žetona");
  return access;
}

async function status() {
  return { woltLoggedIn: !!(await woltRefreshCookie()) };
}

const WOLT_API = "https://consumer-api.wolt.com";

// Počaka, da je v zavihku naložen content script, in mu pošlje sporočilo.
async function sendToTab(tabId, msg, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try { return await chrome.tabs.sendMessage(tabId, msg); }
    catch (e) { await new Promise((r) => setTimeout(r, 500)); }
  }
  throw new Error("Zavihek Wolt se ni odzval — osveži stran na wolt.com in poskusi znova");
}
function waitLoaded(tabId, ms = 15000) {
  return new Promise((resolve) => {
    const onUpd = (id, info) => { if (id === tabId && info.status === "complete") { chrome.tabs.onUpdated.removeListener(onUpd); resolve(); } };
    chrome.tabs.onUpdated.addListener(onUpd);
    setTimeout(() => { chrome.tabs.onUpdated.removeListener(onUpd); resolve(); }, ms);
  });
}
// Vrne zavihek z wolt.com (obstoječ ali nov v ozadju) za izvajanje API klicev.
async function woltTab(preferUrl) {
  if (preferUrl) { const t = await chrome.tabs.create({ url: preferUrl, active: false }); await waitLoaded(t.id); return { tab: t, created: true }; }
  const tabs = await chrome.tabs.query({ url: "https://wolt.com/*" });
  if (tabs.length) return { tab: tabs[0], created: false };
  const t = await chrome.tabs.create({ url: "https://wolt.com/sl", active: false }); await waitLoaded(t.id); return { tab: t, created: true };
}
const woltFetch = (tabId, token, url, method, body) => sendToTab(tabId, { type: "woltFetch", token, clientId, url, method, body });

async function push(args) {
  try { const r = await pushInner(args); extlog(args.who, true, `košarica napolnjena: ${r.restaurant}, ${r.pushed} jedi` + (r.skipped?.length ? `, preskočeno: ${r.skipped.join("; ")}` : "")); return r; }
  catch (e) { extlog(args.who, false, "prenos košarice: " + e.message); throw e; }
}
async function pushInner({ dayId, who }) {
  const refresh = await woltRefreshCookie();
  if (!refresh) throw new Error("Nisi prijavljen na wolt.com — prijavi se in poskusi znova");
  const basket = await malica(`/api/wolt/basket?dayId=${encodeURIComponent(dayId)}&who=${encodeURIComponent(who)}`);
  if (!basket.items.length) throw new Error("Ni jedi z Wolta (vse je vpisano ročno)");
  const token = await woltAccessToken(refresh);
  // Wolt sprejme klice samo z Origin wolt.com → odpremo restavracijo na Woltu in
  // klic izvede content script v tem zavihku.
  const url = basket.venue_url || "https://wolt.com";
  const { tab } = await woltTab(url);
  const r = await woltFetch(tab.id, token, WOLT_API + "/order-xp/v1/baskets", "POST", { items: basket.items, venue_id: basket.venue_id, currency: basket.currency });
  if (!r || !r.ok) throw new Error(r?.error || "Wolt ni sprejel košarice (HTTP " + r?.status + "): " + (r?.text || ""));
  let lines = null;
  try {
    const page = await woltFetch(tab.id, token, WOLT_API + "/order-xp/web/v1/pages/baskets?lat=46.06945&lon=14.52226", "GET");
    const mine = (page.json?.baskets || []).find((x) => x.venue?.id === basket.venue_id);
    if (mine) lines = mine.items.map((i) => ({ count: i.count, name: i.name }));
  } catch (e) {}
  try { await sendToTab(tab.id, { type: "pending", dayId, who, restaurant: basket.restaurant, venue_id: basket.venue_id }); } catch (e) {}
  try { await chrome.tabs.reload(tab.id); await chrome.tabs.update(tab.id, { active: true }); } catch (e) {}
  return { ok: true, restaurant: basket.restaurant, pushed: basket.items.length, skipped: basket.skipped, lines, url, tabId: tab.id };
}

// Poišče današnje plačano naročilo pri isti restavraciji v Woltovi zgodovini in vrne zneske.
// Seznam: {orders:[{purchase_id, payment_time_ts, status, venue_name, total_amount:"25,62 €"}]}
// Podrobnosti: {venue_id, total_price, items_price, delivery_price, tips:{total_tip_amount}, status, creation_time} (v centih)
async function lastOrder(args) {
  try { const r = await lastOrderInner(args); extlog(args.who, true, `prebran znesek z Wolta: ${r.restaurant} ${r.total.toFixed(2)} € (jedi ${r.items.toFixed(2)}, dostava ${r.delivery.toFixed(2)})`); return r; }
  catch (e) { extlog(args.who, false, "branje zneska z Wolta: " + e.message); throw e; }
}
async function lastOrderInner({ dayId, who, tabId }) {
  const refresh = await woltRefreshCookie();
  if (!refresh) throw new Error("Nisi prijavljen na wolt.com");
  const basket = await malica(`/api/wolt/basket?dayId=${encodeURIComponent(dayId)}&who=${encodeURIComponent(who)}`);
  const token = await woltAccessToken(refresh);
  let tab, created = false;
  if (tabId) { try { tab = await chrome.tabs.get(tabId); } catch (e) {} }
  if (!tab) ({ tab, created } = await woltTab(null));
  try {
    const list = await woltFetch(tab.id, token, WOLT_API + "/order-tracking-api/v1/order_history/?limit=20", "GET");
    if (!list?.ok) throw new Error("Wolt zgodovina ni dostopna (HTTP " + list?.status + ")");
    const j = list.json || {};
    const arr = Array.isArray(j) ? j : (j.orders || j.purchases || Object.values(j).find((v) => Array.isArray(v)) || []);
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    const cands = arr.filter((e) => (e.purchase_id || e.order_id || e.id) && (!e.payment_time_ts || e.payment_time_ts >= midnight.getTime()) && !/reject|cancel/i.test(e.status || "")).slice(0, 8);
    if (!cands.length) throw new Error("V Woltovi zgodovini danes ni nobenega naročila — si ga že oddal in plačal?");
    for (const e of cands) {
      const id = e.purchase_id || e.order_id || e.id;
      const d = await woltFetch(tab.id, token, WOLT_API + "/order-tracking-api/v1/order_history/purchase/" + id, "GET");
      const o = d?.json; if (!o) continue;
      if (basket.venue_id && o.venue_id && o.venue_id !== basket.venue_id) continue;
      const c = (v) => Math.round(+v || 0) / 100;
      return { ok: true, total: c(o.total_price), items: c(o.items_price), delivery: c(o.delivery_price), tip: c(o.tips?.total_tip_amount), status: o.status, time: o.creation_time || e.received_at, orderId: id, restaurant: o.venue_name || e.venue_name };
    }
    throw new Error("Danes ni plačanega naročila pri " + basket.restaurant + " v Woltovi zgodovini");
  } finally { if (created) { try { await chrome.tabs.remove(tab.id); } catch (e) {} } }
}

// Zaključi dan v Malici z zneskom, prebranim z Wolta (klic iz opomnika na wolt.com, samo na klik uporabnika).
async function finishFromWolt({ dayId, who, tabId }) {
  const r = await lastOrder({ dayId, who, tabId });
  const res = await fetch(MALICA + "/api/days/" + encodeURIComponent(dayId), {
    method: "POST", credentials: "include", headers: { "content-type": "application/json", "X-Who": encodeURIComponent(who) },
    body: JSON.stringify({ grandTotal: r.total, payer: who, feeSplit: "proportional", status: "ordered" })
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { extlog(who, false, "zaključek iz Wolta: " + (j.error || "Malica HTTP " + res.status)); throw new Error(j.error || "Malica: napaka " + res.status); }
  extlog(who, true, `zaključeno iz Wolta: ${r.total.toFixed(2)} €`);
  return { ...r, finished: true, malicaUrl: MALICA + "/" };
}

// Ob namestitvi odpri Malico (z oznako, da je razširitev pravkar nameščena) —
// stran sama zazna razširitev in pokaže gumb v Povzetku.
chrome.runtime.onInstalled.addListener((d) => {
  if (d.reason === "install") chrome.tabs.create({ url: MALICA + "/?ext=installed" });
});

// Značka na ikoni: zelena kljukica, ko je Wolt prijava zaznana, sicer rdeča pika.
async function updateBadge() {
  const ok = !!(await woltRefreshCookie());
  await chrome.action.setBadgeBackgroundColor({ color: ok ? "#1aa35b" : "#e0453a" });
  await chrome.action.setBadgeText({ text: ok ? "✓" : "!" });
  await chrome.action.setTitle({ title: ok ? "Malica ↔ Wolt — pripravljeno" : "Malica ↔ Wolt — prijavi se na wolt.com" });
}
chrome.runtime.onStartup.addListener(updateBadge);
chrome.runtime.onInstalled.addListener(updateBadge);
chrome.cookies.onChanged.addListener((c) => { if (c.cookie.name === "__wrtoken") updateBadge(); });
updateBadge();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "status") sendResponse(await status());
      else if (msg?.type === "push") sendResponse(await push(msg));
      else if (msg?.type === "lastOrder") sendResponse(await lastOrder(msg));
      else if (msg?.type === "finishFromWolt") sendResponse(await finishFromWolt({ ...msg, tabId: sender.tab?.id }));
      else if (msg?.type === "mydays") sendResponse(await malica("/api/wolt/mydays?who=" + encodeURIComponent(msg.who)));
      else if (msg?.type === "state") sendResponse(await malica("/api/state"));
      else if (msg?.type === "focusTab") { try { const t = await chrome.tabs.update(msg.tabId, { active: true }); await chrome.windows.update(t.windowId, { focused: true }); sendResponse({ ok: true }); } catch (e) { sendResponse({ error: "zavihek zaprt" }); } }
      else sendResponse({ error: "neznano sporočilo" });
    } catch (e) { sendResponse({ error: e.message }); }
  })();
  return true;
});
