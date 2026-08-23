// Teče na wolt.com. Ozadje razširitve mu pošlje klic na Woltov API, ki se izvede iz
// strani wolt.com (Origin: https://wolt.com), ker Wolt zahteve iz razširitve
// (Origin: chrome-extension://…) zavrne s 403. Žeton pride iz ozadja, nič se ne shrani.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "pending") { sessionStorage.setItem("malicaPending", JSON.stringify(msg)); sendResponse({ ok: true }); return; }
  if (msg?.type !== "woltFetch") return;
  (async () => {
    try {
      const h = {
        "accept": "application/json, text/plain, */*",
        "platform": "Web", "app-language": "sl",
        "client-version": "1.16.132", "clientversionnumber": "1.16.132",
        "x-wolt-web-clientid": msg.clientId, "w-wolt-session-id": msg.clientId,
        "authorization": "Bearer " + msg.token
      };
      if (msg.body) h["content-type"] = "application/json";
      const r = await fetch(msg.url, { method: msg.method || "GET", headers: h, credentials: "include", body: msg.body ? JSON.stringify(msg.body) : undefined });
      const text = await r.text();
      let json = null; try { json = JSON.parse(text); } catch (e) {}
      sendResponse({ status: r.status, ok: r.ok, json, text: text.slice(0, 300) });
    } catch (e) { sendResponse({ status: 0, ok: false, error: "Napaka v zavihku Wolt: " + e.message }); }
  })();
  return true;
});

// ---- Opomnik po oddanem naročilu -------------------------------------------
// Ko je bila košarica napolnjena iz Malice, ta zavihek v sessionStorage hrani
// "malicaPending". Ko Wolt preklopi na sledenje naročilu, pokažemo opomnik z gumbom,
// ki (samo na klik) prebere plačani znesek in zaključi dan v Malici.
(function () {
  const pend = () => { try { return JSON.parse(sessionStorage.getItem("malicaPending") || "null"); } catch (e) { return null; } };
  const orderPlaced = () =>
    /\/order-tracking\//.test(location.pathname) || /\/orders?\/[a-f0-9]{24}/.test(location.pathname) ||
    performance.getEntriesByType("resource").some((e) => /order-tracking-api\/v1\/(details|purchase|order_tracking|tracking)/.test(e.name) && !/order_history/.test(e.name));
  let shown = false;
  const eur = (n) => (+n || 0).toFixed(2).replace(".", ",") + " €";
  function toast(p) {
    if (shown || document.getElementById("malicaReminder")) return; shown = true;
    const box = document.createElement("div"); box.id = "malicaReminder";
    box.style.cssText = "position:fixed;top:16px;right:16px;z-index:2147483647;width:320px;background:#fff;color:#202125;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.25);padding:16px;font:14px/1.4 -apple-system,'Segoe UI',Roboto,sans-serif";
    box.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:15px">🍽 Malica</b><button id="mrX" style="border:none;background:none;font-size:18px;cursor:pointer;color:#999">×</button></div>' +
      '<div style="margin:6px 0 10px">Naročilo pri <b>' + String(p.restaurant || "").replace(/</g, "&lt;") + '</b> je oddano. Zaključi ga še v Malici, da se znesek razdeli med sodelavce.</div>' +
      '<button id="mrGo" style="width:100%;padding:10px;border:none;border-radius:8px;background:#009de0;color:#fff;font-weight:600;cursor:pointer;font-size:14px">💶 Preberi znesek z Wolta in zaključi v Malici</button>' +
      '<div id="mrOut" style="margin-top:8px;font-size:13px;color:#717173"></div>';
    document.body.appendChild(box);
    box.querySelector("#mrX").onclick = () => box.remove();
    box.querySelector("#mrGo").onclick = async () => {
      const b = box.querySelector("#mrGo"), out = box.querySelector("#mrOut"); b.disabled = true; b.textContent = "Berem z Wolta…";
      const r = await chrome.runtime.sendMessage({ type: "finishFromWolt", dayId: p.dayId, who: p.who }).catch((e) => ({ error: e.message }));
      if (!r || r.error) { out.style.color = "#e0453a"; out.textContent = "✗ " + (r?.error || "napaka"); b.disabled = false; b.textContent = "Poskusi znova"; return; }
      out.style.color = "#1aa35b"; out.innerHTML = "✓ Zaključeno v Malici: plačano <b>" + eur(r.total) + "</b> (jedi " + eur(r.items) + " · dostava " + eur(r.delivery) + ")";
      b.textContent = "Odpri obračun v Malici ↗"; b.disabled = false; b.onclick = () => window.open(r.malicaUrl, "_blank");
      sessionStorage.removeItem("malicaPending");
    };
  }
  setInterval(() => { const p = pend(); if (p && !shown && orderPlaced()) toast(p); }, 2000);
})();
