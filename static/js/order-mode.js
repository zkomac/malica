// Phone ordering mode (/o/<day>): checklist with deep links to every dish on Wolt.
// Poenostavljena naročilna stran za telefon: /order/<dayId>
const orderDone = {};  // dayId -> Set(indeksov odkljukanih), v pomnilniku
async function renderOrderMode(dayId){
  document.body.classList.add('order-mode');
  const day = state.days.find(d=>d.id===dayId);
  const root = $('#main'); $('#days').innerHTML=''; document.querySelector('header').style.display='none';
  if(!day){ root.innerHTML = `<div class="empty"><h2>Naročilo ni najdeno</h2>Povezava je morda zastarela.<br><a class="btn primary" style="margin-top:12px" href="/">Odpri Malico</a></div>`; return; }
  const v = day.venue || {};
  // združi jedi po vrsti+dodatkih
  const items = {};
  for(const o of day.orders){ const k=o.itemId+'|'+o.item+(o.options?' — '+o.options:''); items[k] = items[k]||{qty:0, who:[], item:o.item, options:o.options, note:[], itemId:o.itemId}; items[k].qty+=o.qty; items[k].who.push(o.person+(o.qty>1?' ×'+o.qty:'')); if(o.note) items[k].note.push(o.person+': '+o.note); }
  const list = Object.values(items);
  const itemUrl = it => v.url && it.itemId && /^[a-f0-9]{24}$/.test(it.itemId) ? `${v.url}/itemid-${it.itemId}` : (v.url||'');
  const c = calc(day);
  const doneSet = orderDone[dayId] ||= new Set();
  const draw = () => {
    root.innerHTML = `<div class="ordermode">
      <div class="om-head"><a href="/" class="om-back">‹ Malica</a><div class="om-progress">${doneSet.size}/${list.length} dodano</div></div>
      <h1>${esc(day.restaurant)}</h1>
      <p class="sub">${dateLong(day.date)} · ${nOrders(day.orders.length)}${day.deadline?` · rok ${esc(day.deadline)}`:''}</p>
      <p class="om-hint">Pri vsaki jedi klikni <b>Odpri na Woltu</b>, izberi dodatke in jo daj v košarico. Potem jo odkljukaj.</p>
      <div class="om-list">${list.map((it,i)=>`
        <div class="om-item ${doneSet.has(i)?'done':''}" data-i="${i}">
          <button class="om-check" data-check="${i}" title="Označi kot dodano">${doneSet.has(i)?'✓':''}</button>
          <div class="om-body"><div class="om-name"><b>${it.qty}×</b> ${esc(it.item)}</div>${it.options?`<div class="sub">${esc(it.options)}</div>`:''}${it.note.length?`<div class="sub">✎ ${it.note.map(esc).join(' · ')}</div>`:''}<div class="sub">${esc(it.who.join(', '))}</div></div>
          ${itemUrl(it)?`<a class="btn primary om-open" href="${esc(itemUrl(it))}" target="_blank" rel="noopener" data-open="${i}">Odpri na Woltu ↗</a>`:'<span class="sub">ročni vnos</span>'}
        </div>`).join('')}</div>
      <div class="om-foot">
        <div class="om-total"><span>Jedi skupaj</span><b>${fmt(c.subtotal)}</b></div>
        ${v.url?`<a class="btn" href="${esc(v.url)}" target="_blank" rel="noopener">Odpri restavracijo na Woltu ↗</a>`:''}
        ${doneSet.size===list.length && list.length?`<div class="banner ok" style="margin-top:10px"><div><b>Vse dodano 🎉</b><div class="sub">Na Woltu preveri košarico in oddaj naročilo, potem spodaj vpiši, koliko si plačal.</div></div></div>`:''}
        ${day.status==='open' ? `<div class="card om-fin"><h3>Zaključi naročilo</h3>
          <p class="sub" style="margin:-4px 0 10px">Ko oddaš naročilo, vpiši <b>končni znesek z Wolta</b> (z dostavo in stroški). Razliko razdelimo med sodelavce.</p>
          <form id="omFin">
            <label>Skupaj plačano na Woltu (€)</label><input name="grandTotal" type="number" step="0.01" min="0" inputmode="decimal" placeholder="${fmt(c.subtotal).replace(' €','')}" style="font-size:1.25rem;width:100%">
            <div class="row" style="margin-top:8px"><div><label>Plačal/a</label><select name="payer">${state.people.map(p=>`<option ${(day.payer||day.orderer)===p?'selected':''}>${esc(p)}</option>`).join('')}</select></div>
            <div><label>Kako razdelimo doplačilo</label><select name="feeSplit"><option value="proportional">sorazmerno</option><option value="equal" ${day.feeSplit==='equal'?'selected':''}>enako na osebo</option></select></div></div>
            <div id="omFinPreview" class="sub" style="margin-top:8px"></div>
          </form>
          <button class="btn primary" data-act="omfinish" style="margin-top:10px">✓ Zaključi in pokaži obračun</button></div>`
        : `<div class="banner ok" style="margin-top:10px"><div><b>Naročilo zaključeno</b><div class="sub">Plačano ${fmt(day.grandTotal||c.subtotal)}${day.payer?` · plačnik ${esc(day.payer)}`:''}</div></div><a class="btn primary" href="/" style="margin-top:8px">Odpri obračun</a></div>`}
      </div></div>`;
    omPreview();
  };
  const omRead = () => { const f=$('#omFin'); if(!f) return null; const d=Object.fromEntries(new FormData(f)); return {...day, grandTotal:+d.grandTotal||0, feeSplit:d.feeSplit, payer:d.payer}; };
  const omPreview = () => { const d=omRead(); const el=$('#omFinPreview'); if(!d||!el) return; const cc=calc(d);
    el.innerHTML = (cc.extra?`Doplačilo ${fmt(cc.extra)} · `:'Brez doplačil · ') + cc.rows.map(r=>`${esc(r.person)} <b>${fmt(r.total)}</b>`).join(' · '); };
  window._omRead = omRead; window._omPreview = omPreview;
  draw();
  if(!window._omBound){ window._omBound = true;
    root.addEventListener('click', e=>{
      if(!orderRoute()) return;
      const ch=e.target.closest('[data-check]'); const op=e.target.closest('[data-open]');
      const fin=e.target.closest('[data-act="omfinish"]');
      if(ch){ const i=+ch.dataset.check; doneSet.has(i)?doneSet.delete(i):doneSet.add(i); draw(); }
      else if(op){ const i=+op.dataset.open; doneSet.add(i); setTimeout(draw,100); }
      else if(fin){ const d=window._omRead && window._omRead(); if(!d) return; const cc=calc(d);
        if(d.grandTotal && d.grandTotal < cc.subtotal && !confirm(`Vpisani znesek (${fmt(d.grandTotal)}) je nižji od cene jedi (${fmt(cc.subtotal)}). Vseeno zaključim?`)) return;
        fin.disabled=true; mutate(`/api/days/${d.id}`, {grandTotal:d.grandTotal, feeSplit:d.feeSplit, payer:d.payer, status:'ordered'}).then(()=>toast('✓ Naročilo zaključeno')).catch(()=>{ fin.disabled=false; }); }
    });
    root.addEventListener('input', e=>{ if(orderRoute() && e.target.closest('#omFin') && window._omPreview) window._omPreview(); });
    root.addEventListener('change', e=>{ if(orderRoute() && e.target.closest('#omFin') && window._omPreview) window._omPreview(); });
  }
}
