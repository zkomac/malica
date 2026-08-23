const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);
function mark(step, ok, text) {
  const el = $(step); el.classList.remove("ok", "bad"); el.classList.add(ok ? "ok" : "bad"); $(step + "t").textContent = text;
}
let me = null;
const openTab = (url) => chrome.tabs.create({ url });
function action(step, label, url) {
  const box = $(step + "a"); box.innerHTML = "";
  if (!url) return;
  const b = document.createElement("button"); b.className = "btn sm"; b.textContent = label;
  b.addEventListener("click", () => openTab(url)); box.appendChild(b);
}
async function init() {
  $("s3").style.display = "none"; $("msg").textContent = ""; $("days").innerHTML = "";
  const st = await send({ type: "status" });
  mark("s1", !!st.woltLoggedIn, st.woltLoggedIn ? "✓ prijava zaznana" : "✗ nisi prijavljen — prijavi se in se vrni sem");
  action("s1", "Prijava na Woltu ↗", st.woltLoggedIn ? null : "https://wolt.com/sl/login");
  const state = await send({ type: "state" });
  if (state.error) {
    mark("s2", false, "✗ " + state.error);
    action("s2", "Odpri Malico in vnesi PIN ↗", "https://malica.stavio.net/");
    return;
  }
  mark("s2", true, "✓ skupina " + (state.group?.name || ""));
  action("s2", "", null);
  if (!st.woltLoggedIn) return;
  $("s3").style.display = "";
  const sel = $("who");
  sel.innerHTML = state.people.map((p) => `<option>${p.replace(/</g, "&lt;")}</option>`).join("");
  const saved = localStorage.getItem("who");
  if (saved && state.people.includes(saved)) sel.value = saved;
  sel.onchange = loadDays;
  await loadDays();
}
$("recheck").addEventListener("click", init);
// Ko se uporabnik prijavi na Woltu v drugem zavihku, se popup ob naslednjem odprtju
// samodejno posodobi; če ostane odprt (npr. odpet), ga osveži sprememba piškotka.
chrome.cookies.onChanged.addListener((c) => { if (c.cookie.name === "__wrtoken") init(); });
async function loadDays() {
  me = $("who").value; localStorage.setItem("who", me);
  const d = await send({ type: "mydays", who: me });
  const days = (d?.days || []).filter((x) => x.hasVenue && x.orders > 0);
  $("days").innerHTML = days.length
    ? days.map((x) => `<div class="day"><div><b>${x.restaurant}</b><div class="sub">${x.orders} naročil${x.status === "ordered" ? " · ✓ zaključeno" : ""}</div></div>
        <button data-day="${x.id}">🛒 Prenesi jedi v Wolt košarico</button>
        ${x.status === "ordered" ? "" : `<button class="ghost" data-finish="${x.id}" title="Prebere plačani znesek iz Woltove zgodovine in zaključi dan v Malici">💶 Zaključi naročilo in pošlji skupen znesek v Malico</button>`}</div>`).join("")
    : `<div class="sub">Danes ni naročila, kjer bi naročal <b>${me}</b>. Gumb najdeš tudi v Malici (Povzetek za Wolt).</div>`;
}
$("msg").addEventListener("click", async (e) => {
  const u = e.target.closest("[data-open-url]"); if (u) { openTab(u.dataset.openUrl); return; }
  const f = e.target.closest("[data-focus]"); if (!f) return;
  const r = await send({ type: "focusTab", tabId: +f.dataset.focus });
  if (r?.error) openTab(f.dataset.url);
});
$("days").addEventListener("click", async (e) => {
  const f = e.target.closest("[data-finish]");
  if (f) {
    const out = $("msg"); out.className = "msg"; out.innerHTML = '<span class="spin"></span>Berem plačani znesek z Wolta…'; f.disabled = true;
    const r = await send({ type: "finishFromWolt", dayId: f.dataset.finish, who: me });
    if (!r || r.error) { out.className = "msg bad"; out.textContent = "✗ " + (r?.error || "napaka") + " — znesek lahko vpišeš sam v Malici (Naročilo ▾ → Zaključi naročilo)."; f.disabled = false; }
    else {
      const eur = (n) => (+n || 0).toFixed(2).replace(".", ",") + " €";
      out.className = "msg ok";
      out.innerHTML = `✓ Zaključeno v Malici: plačano <b>${eur(r.total)}</b><div class="sub">jedi ${eur(r.items)} · dostava ${eur(r.delivery)}${r.tip ? " · napitnina " + eur(r.tip) : ""} · ${r.time || ""}</div><button class="btn" data-open-url="${r.malicaUrl}">Odpri obračun v Malici ↗</button>`;
      loadDays();
    }
    return;
  }
  const b = e.target.closest("[data-day]"); if (!b) return;
  const out = $("msg"); out.className = "msg"; out.innerHTML = '<span class="spin"></span>Pošiljam v Wolt…'; b.disabled = true;
  const r = await send({ type: "push", dayId: b.dataset.day, who: me });
  if (r.error) { out.className = "msg bad"; out.textContent = "✗ " + r.error; }
  else {
    out.className = "msg ok";
    out.innerHTML = `✓ V košarici pri <b>${r.restaurant}</b>: ${r.pushed} jedi.` +
      (r.lines ? `<div class="sub">${r.lines.map((l) => `${l.count}× ${l.name}`).join(" · ")}</div>` : "") +
      (r.skipped.length ? `<div class="sub warn">Dodaj ročno: ${r.skipped.join("; ")}</div>` : "") +
      `<button class="btn" data-focus="${r.tabId}" data-url="${r.url}">Odpri Wolt, preveri in plačaj ↗</button>`;
  }
  b.disabled = false;
});
init();
