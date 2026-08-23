// Rendering of the main screen: day strip, day header, menu, cart and summary.
// ---------- render ----------
const orderRoute = () => { const m = location.pathname.match(/^\/o(?:rder)?\/([a-z0-9]+)/i); return m ? m[1] : null; };

function render(){
  const oid = orderRoute();
  if(oid){ renderOrderMode(oid); return; }
  $('#locLabel').textContent = state.location?.label || 'Lokacija';
  $('#meSelect').innerHTML = '<option value="">Kdo si?</option>' + state.people.map(p=>`<option ${p===me?'selected':''}>${esc(p)}</option>`).join('') + '<option value="__switch">⇄ Nisem jaz — zamenjaj</option>' + (state.admin?'<option value="__admin">🛠 Admin</option>':'') + '<option value="__logout">⎋ Odjava iz skupine</option>';
  if(state.group) $('#groupName').textContent = state.group.name;

  const T = todayIso();
  const grp = d => d.date===T ? 0 : d.date>T ? 1 : 2;
  // v vrstici samo današnji + prihodnji predlogi; pretekli dnevi gredo v Zgodovino
  let days = [...state.days].filter(d=>grp(d)!==2).sort((a,b)=> grp(a)-grp(b) || a.date.localeCompare(b.date));
  const pastCount = state.days.filter(d=>grp(d)===2).length;
  if(!currentDayId || !state.days.find(d=>d.id===currentDayId)) currentDayId = days[0]?.id || state.days[0]?.id || null;
  const chip = d => `<div class="day g${grp(d)} ${d.id===currentDayId?'active':''}" data-day="${d.id}">
      <button class="delchip" data-delday="${d.id}" title="Izbriši dan">×</button><em class="tag-g g${grp(d)}">${grp(d)===0?'Danes':(relDay(d.date)||'Prihodnje')}</em><b>${esc(d.restaurant)}</b><span><i class="st ${d.status}"></i>${dateSl(d.date)} · ${nOrders(d.orders.length)}</span></div>`;
  const todays = days.filter(d=>grp(d)===0), future = days.filter(d=>grp(d)===1);
  $('#days').innerHTML = `<div class="day add" data-new><b>+ Predlagaj</b><span>za danes, ${dateSl(todayIso())}</span></div>` + todays.map(chip).join('')
      + (pastCount?`<div class="day hist" data-act="history"><b>🕘 Zgodovina</b><span>${pastCount} ${plural(pastCount,'dan','dneva','dnevi','dni')}</span></div>`:'')
      + (future.length?`<div class="future"><div class="future-label">📅 Prihodnji predlogi</div><div class="future-list">${future.map(chip).join('')}</div></div>`:'');

  const day = curDay();
  const todayDay = state.days.find(d=>d.date===todayIso());
  const banner = todayDay || !state.days.length ? '' : `<div class="banner"><div><b>Danes, ${dateSl(todayIso()).replace(/^[^,]+, /,'')} še ni predloga.</b><div class="sub">Kdo predlaga, kam?</div></div><button class="btn primary" data-new>🍽 Kam gremo danes? Predlagaj restavracijo</button></div>`;
  $('#main').innerHTML = banner + (day ? renderDay(day) : `<div class="empty"><h2>Za danes še nihče ni nič predlagal</h2><p>Izberi restavracijo na Woltu, sodelavci si izberejo jedi, eden naroči.</p><button class="btn primary" data-new>🍽 Kam gremo danes? Predlagaj restavracijo</button></div>`);
  if(day && tab==='menu' && day.venue?.slug) renderMenu(day);
  if(day && tab==='summary' && $('#woltStatus')) extCall({type:'status'}).then(st=>{ const el=$('#woltStatus'); if(!el) return;
    el.innerHTML = st.woltLoggedIn ? '✓ Prijava na wolt.com zaznana' : `⚠ Nisi prijavljen na wolt.com. <a href="https://wolt.com/sl/login" target="_blank" rel="noopener">Prijavi se ↗</a> in potem klikni gumb.`; });
  if(day && tab==='summary'){ const cv=$('#orderQR'); if(cv && window.QR && matchMedia('(min-width:641px)').matches){ try{ QR.toCanvas(cv, cv.dataset.url, {scale:5, border:2}); }catch(e){} } }
}

function renderDay(day){
  const v = day.venue || {};
  const open = canOrder(day);
  const late = day.status==='open' && isToday(day) && deadlinePassed(day);
  const future = day.status==='open' && day.date>serverToday();
  const past = day.status==='open' && day.date<serverToday();
  const c = calc(day);
  let html = `<div class="venue-block ${day.status==='ordered'?'done':''}"><div class="hero" style="${v.image?`background-image:url('${esc(img(v.image,1200))}')`:''}"></div>
  <div class="venue-head">
    <div style="min-width:0">
      <h1>${esc(day.restaurant)}</h1>
      <div class="meta">
        <span class="status ${day.status} ${late?'late':''}">${day.status==='ordered'?'✓ Naročeno':late?'⏰ Rok potekel':future?'📅 Predlog':past?'Preteklo':'● Odprto'}</span>
        <span>${dateLong(day.date)}</span>
        ${day.deadline?`<span>⏰ ${esc(day.deadline)}</span>`:''}
        ${v.rating?`<span>⭐ ${v.rating}</span>`:''}
        ${v.estimate?`<span>🛵 ${esc(v.estimate)}′</span>`:''}
        ${(v.url||day.url)?`<a href="${esc(v.url||day.url)}" target="_blank" rel="noopener">Wolt ↗</a>`:''}
      </div>
      <div class="meta orderer-row"><span>🛵 Naroča:</span>
        <select class="inline-sel" data-orderer ${!open?'disabled':''}><option value="">— kdo naroča? —</option>${state.people.map(p=>`<option ${day.orderer===p?'selected':''}>${esc(p)}</option>`).join('')}</select>
      </div>
    </div>
    <div class="actions">
      <div class="dd"><button class="btn" data-act="daymenu">Naročilo ▾</button>
        <div class="dd-menu" id="dayMenu">
          <div class="dd-head"><b>${esc(day.restaurant)}</b><span class="sub">${nOrders(day.orders.length)} · ${open?'odprto':'zaključeno'}${day.orderer?` · naroča ${esc(day.orderer)}`:''}</span></div>
          ${open && extReady && me && me===day.orderer && day.orders.length ? `<div class="dd-label">Z razširitvijo Malica ↔ Wolt</div>
          <button data-act="woltpush-go"><i>🛒</i><span>Prenesi jedi v Wolt košarico<small>odpre Wolt s polno košarico</small></span></button>
          <button data-act="wolttotal-go"><i>💶</i><span>Preberi plačani znesek in zaključi<small>iz Woltove zgodovine naročil</small></span></button>
          <div class="dd-sep"></div>`:''}
          ${open ? `<button data-act="finish" ${!day.orders.length?'disabled':''}><i>✓</i><span>Zaključi naročilo<small>sam vpišeš, koliko si plačal</small></span></button>`
                 : `<button data-act="status" data-v="open"><i>↩</i><span>Ponovno odpri naročilo<small>dovoli spremembe naročil</small></span></button><button data-act="edit-fees"><i>💶</i><span>Uredi stroške naročila<small>znesek, plačnik, delitev</small></span></button>`}
          <button data-act="editday"><i>✎</i><span>Uredi dan<small>restavracija, rok, kdo naroča</small></span></button>
          <div class="dd-sep"></div>
          <button class="danger" data-delday="${day.id}"><i>🗑</i><span>Izbriši restavracijo in vsa naročila<small>${day.orders.length?`izbriše ${nOrders(day.orders.length)} — ni mogoče razveljaviti`:'brez naročil'}</small></span></button>
        </div></div>
    </div>
  </div></div>
  <div class="tabs">
    <button class="${tab==='menu'?'active':''}" data-tab="menu">Meni</button>
    <button class="${tab==='orders'?'active':''}" data-tab="orders">Naročila<span class="n">${day.orders.length}</span></button>
    <button class="${tab==='summary'?'active':''}" data-tab="summary">Povzetek za Wolt</button>
    <button class="${tab==='split'?'active':''}" data-tab="split">Obračun</button>
  </div>`;

  if(tab==='menu'){
    html += `<div class="menu-layout">` + (v.slug ? `<div id="menu"><div class="spinner">Nalagam meni z Wolta…</div></div>`
      : `<div class="empty">Ta dan nima povezane Wolt restavracije.${canOrder(day)?'<br><button class="btn primary" style="margin-top:12px" data-act="manual">+ Ročni vnos naročila</button>':''}</div>`)
      + renderCart(day) + `</div>` + `<div class="cartbar" data-act="cart"><span>🛒 ${nOrders(day.orders.length)}</span><span>${fmt(c.subtotal)} ›</span></div>`;
  }

  if(tab==='orders'){
    const byPerson = {};
    for(const o of day.orders) (byPerson[o.person] ||= []).push(o);
    const persons = Object.keys(byPerson).sort((a,b)=> (a===me?-1:b===me?1:a.localeCompare(b)));
    html += `<div class="table-wrap"><table><thead><tr><th>Kdo</th><th>Jed</th><th class="num">Kol.</th><th class="num">Cena</th><th class="num">Skupaj</th><th></th></tr></thead><tbody>`;
    for(const p of persons) for(const o of byPerson[p]){
      html += `<tr class="${p===me?'mine':''}"><td><b>${esc(p)}</b></td><td>${esc(o.item)}${o.options?`<div class="sub">${esc(o.options)}</div>`:''}${o.note?`<div class="sub">✎ ${esc(o.note)}</div>`:''}</td>
        <td class="num">${o.qty}</td><td class="num">${fmt(o.price)}</td><td class="num"><b>${fmt(o.price*o.qty)}</b></td>
        <td class="num">${open?`<button class="icon" data-edit="${o.id}" title="Uredi">✎</button> <button class="icon" data-delorder="${o.id}" title="Izbriši">×</button>`:''}</td></tr>`;
    }
    if(!day.orders.length) html += `<tr><td colspan="6" class="sub">Še ni naročil — izberi si kaj iz menija.</td></tr>`;
    html += `<tr class="total"><td colspan="4">Jedi skupaj</td><td class="num">${fmt(c.subtotal)}</td><td></td></tr>${c.extra?`<tr class="total"><td colspan="4">Doplačilo (dostava ipd.)</td><td class="num">${fmt(c.extra)}</td><td></td></tr><tr class="total"><td colspan="4"><b>Skupaj plačano na Woltu</b></td><td class="num"><b>${fmt(c.total)}</b></td><td></td></tr>`:''}</tbody></table></div>
      <div style="margin-top:14px"><button class="btn" data-act="manual" ${!open?'disabled':''}>+ Ročni vnos (jed, ki je ni v meniju)</button></div>`;
  }

  if(tab==='summary'){
    const items = {};
    for(const o of day.orders){ const k=o.item+(o.options?' — '+o.options:'')+(o.note?' ('+o.note+')':''); items[k] = items[k]||{qty:0, who:[], itemId:o.itemId}; items[k].qty+=o.qty; items[k].who.push(o.person+(o.qty>1?' ×'+o.qty:'')); }
    let txt = `${day.restaurant} — ${dateLong(day.date)}\n\n`;
    for(const [k,v] of Object.entries(items)) txt += `${v.qty}× ${k}   [${v.who.join(', ')}]\n`;
    txt += `\nSkupaj jedi: ${fmt(c.subtotal)}`;
    const itemUrl = id => v.url && id ? `${v.url}/itemid-${id}` : '';
    const checklist = Object.entries(items).map(([k,x])=>`<label class="chk"><input type="checkbox"><span class="q">${x.qty}×</span><span class="nm">${esc(k)}<div class="sub">${esc(x.who.join(', '))}</div></span>${itemUrl(x.itemId)?`<a class="btn sm ghost" href="${esc(itemUrl(x.itemId))}" target="_blank" rel="noopener">Odpri na Woltu ↗</a>`:''}</label>`).join('');
    html += `<p class="sub">Seznam za ${day.orderer?`<b>${esc(day.orderer)}</b>, ki naroča`:'tistega, ki naroča'} — enake jedi z enakimi dodatki so združene.</p>
      ${v.id && day.orders.length && me && me===day.orderer && extReady ? `<div class="card" id="woltPush"><h3>🛒 Prenesi jedi v Wolt košarico</h3>
        <p class="sub" style="margin:-6px 0 10px">Odpre se Wolt in v <b>tvoji</b> košarici so že vse jedi z dodatki (uporabi tvojo prijavo na wolt.com). Nič se ne shranjuje, plačaš sam na Woltu.</p>
        <div id="woltStatus" class="sub" style="margin-bottom:8px">Preverjam prijavo na Woltu…</div>
        <button class="btn primary" id="woltPushBtn" data-act="woltpush">🛒 Prenesi ${nOrders(day.orders.length)} v Wolt košarico</button><div id="woltPushResult" style="margin-top:10px"></div>
        ${day.status==='open'?`<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line)"><div class="sub" style="margin-bottom:8px">Ko na Woltu plačaš, lahko končni znesek potegneš kar iz Woltove zgodovine naročil.</div><button class="btn" id="woltTotalBtn" data-act="wolttotal">💶 Preberi plačani znesek z Wolta in zaključi</button><div id="woltTotalResult" style="margin-top:8px"></div></div>`:''}</div>`:''}
      ${open && day.orders.length ? `<div class="card"><h3>✓ Zaključi naročilo</h3>
        <p class="sub" style="margin:-6px 0 10px">Ko je naročilo oddano na Woltu, vpiši končni znesek (z dostavo in stroški) — Malica razdeli razliko med sodelavce in pripravi obračun.</p>
        <button class="btn primary" data-act="finish">✓ Zaključi naročilo</button></div>`
        : day.orders.length ? `<div class="card"><h3>✓ Naročilo je zaključeno</h3><p class="sub" style="margin:-6px 0 10px">Plačano ${fmt(day.grandTotal||calc(day).subtotal)}${day.payer?` · plačnik ${esc(day.payer)}`:''}.</p><button class="btn" data-tab="split">Odpri obračun ›</button></div>`:''}
      ${v.id && day.orders.length ? `<div class="card"><h3>📱 Naročam s telefona</h3>
        <div class="os-qr"><canvas id="orderQR" data-url="${location.origin}/o/${day.id}"></canvas><div class="sub">Skeniraj s telefonom in jedi po vrsti dodaj v Wolt košarico.</div></div>
        <a class="btn primary os-mobilebtn" href="/o/${day.id}">📱 Odpri seznam za naročanje</a></div>`:''}
      ${checklist?`<div class="card"><h3>Seznam za vnos v Wolt</h3><p class="sub" style="margin:-6px 0 10px">Povezava odpre jed na Woltu — izberi dodatke in jo daj v košarico. Odkljukaj, kar si že dodal.</p>${checklist}</div>`:''}
      <details><summary class="sub" style="cursor:pointer">Povzetek kot besedilo (za kopiranje v chat)</summary><pre class="summary" id="summaryText" style="margin-top:10px">${esc(txt)}</pre>
      <button class="btn" data-act="copy">📋 Kopiraj</button></details>
      ${v.url?`<p><a class="btn ghost" href="${esc(v.url)}" target="_blank" rel="noopener">Odpri restavracijo na Woltu ↗</a></p>`:''}`;
  }

  if(tab==='split'){
    const payer = day.payer;
    const myRow = c.rows.find(r=>r.person===me);
    const others = c.rows.filter(r=>r.person!==payer);        // vsi razen plačnika
    const unpaid = others.filter(r=>!day.paid.includes(r.person));
    if(day.status==='open'){
      html += `<div class="banner"><div><b>Naročilo še ni zaključeno.</b><div class="sub">Ko ${day.orderer?`<b>${esc(day.orderer)}</b>`:'tisti, ki naroča,'} odda naročilo na Woltu, klikne <b>Zaključi naročilo</b> in vpiše, koliko je plačal.</div></div>${day.orders.length?`<button class="btn primary" data-act="finish">Zaključi naročilo</button>`:''}</div>`;
    } else if(payer && myRow && me!==payer){
      const paid = day.paid.includes(me);
      html += `<div class="banner ${paid?'ok':''}"><div><b>${paid?`Poravnano ✓`:`Dolguješ ${fmt(myRow.total)}`}</b><div class="sub">${paid?`Svoj delež si že nakazal/a osebi ${esc(payer)}.`:`Nakaži osebi <b>${esc(payer)}</b> ${fmt(myRow.total)}.`}</div></div><button class="btn ${paid?'':'primary'}" data-paid-toggle="${esc(me)}">${paid?'Označi kot neporavnano':'✓ Sem nakazal/a'}</button></div>`;
    } else if(payer && me===payer && others.length){
      html += `<div class="banner ${unpaid.length?'':'ok'}"><div><b>${unpaid.length?`Čakaš še ${fmt(unpaid.reduce((a,r)=>a+r.total,0))}`:'Vsi so poravnali 🎉'}</b><div class="sub">${unpaid.length?'Odkljukaj spodaj, ko ti kdo nakaže. '+unpaid.map(r=>`${esc(r.person)} ${fmt(r.total)}`).join(' · '):'Vsi so poravnali. 🎉'}</div></div></div>`;
    }
    html += `<div class="card"><div class="meta"><span>Jedi <b>${fmt(c.subtotal)}</b></span>${c.extra?`<span>Doplačilo <b>${fmt(c.extra)}</b></span>`:''}<span>Skupaj <b>${fmt(c.total)}</b></span>${payer?`<span>Plačal/a: <b>${esc(payer)}</b></span>`:''}${day.status==='ordered'?`<button class="btn sm" style="margin-left:auto" data-act="edit-fees">Uredi znesek</button>`:''}</div></div>`;
    if(others.length){
      html += `<h3 style="margin:18px 0 8px">Kdo koliko nakaže</h3>
        <p class="sub" style="margin:-6px 0 10px">Vsak odkljuka, ko ${esc(payer||'plačniku')} nakaže svoj delež (ročno, aplikacija ne preverja nakazil).</p>
        <div class="table-wrap"><table><thead><tr><th>Oseba</th>${c.extra?`<th class="num">Jedi</th><th class="num">Doplačilo</th>`:''}<th class="num">Nakaže</th><th>Poravnano</th></tr></thead><tbody>`;
      for(const r of c.rows){
        const isPayer = r.person===payer;
        const paid = isPayer || day.paid.includes(r.person);
        html += `<tr class="${paid&&!isPayer?'paid':''} ${r.person===me?'mine':''}"><td><b>${esc(r.person)}</b>${isPayer?'<span class="pill-badge">plačnik</span>':''}</td>${c.extra?`<td class="num sub">${fmt(r.items)}</td><td class="num sub">${fmt(r.share)}</td>`:''}<td class="num">${isPayer?'<span class="sub">—</span>':`<b>${fmt(r.total)}</b>`}</td>
          <td>${isPayer?'<span class="sub">—</span>':`<input type="checkbox" data-paid="${esc(r.person)}" ${paid?'checked':''} ${day.status!=='ordered'?'disabled':''} style="width:20px;height:20px;accent-color:var(--blue)">`}</td></tr>`;
      }
      html += `</tbody></table></div>`;
    } else {
      html += `<p class="sub" style="margin-top:12px">Samo eno naročilo (${esc(payer||day.orders[0]?.person||'')}) — ni deljenja.</p>`;
    }
  }
  return html;
}

function cartModal(day){
  const c = calc(day);
  const by = {};
  for(const o of day.orders) (by[o.person] ||= []).push(o);
  const persons = Object.keys(by).sort((a,b)=> (a===me?-1:b===me?1:a.localeCompare(b)));
  let h = `<div class="body"><h2>🛒 Naročilo skupine</h2><p class="desc">${esc(day.restaurant)} · ${nOrders(day.orders.length)}</p>`;
  if(!day.orders.length) h += `<p class="sub">Še nihče ni nič izbral.</p>`;
  for(const p of persons){
    h += `<div class="person ${p===me?'me':''}" style="margin:12px 0 4px;font-size:.8rem;font-weight:700;color:${p===me?'var(--blue)':'var(--ink-2)'};text-transform:uppercase;letter-spacing:.04em">${p===me?'Moje naročilo':esc(p)}</div>`;
    for(const o of by[p]) h += `<div class="line" style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--line-soft)"><span style="flex:0 0 26px;color:var(--ink-2)">${o.qty}×</span><span style="flex:1;min-width:0">${esc(o.item)}${o.options?`<div class="sub">${esc(o.options)}</div>`:''}${o.note?`<div class="sub">✎ ${esc(o.note)}</div>`:''}</span><span class="sub" style="white-space:nowrap">${fmt(o.price*o.qty)}</span>${canOrder(day)?`<button class="icon" data-cartdel="${o.id}" title="Odstrani" style="flex:0 0 auto">🗑</button>`:''}</div>`;
  }
  h += `<div style="display:flex;justify-content:space-between;font-weight:700;padding-top:12px"><span>Skupaj</span><span>${fmt(c.subtotal)}</span></div></div>
    <div class="foot">${canOrder(day)?`<button class="btn" data-act="manual">+ Ročni vnos</button>`:''}<button class="btn primary" data-tab="summary" style="flex:1">Povzetek za Wolt ›</button></div>`;
  const modal = openModal(h);
  modal.addEventListener('click', async e=>{
    if(e.target.closest('[data-tab],[data-act]')){ closeModal(); return; }
    const d = e.target.closest('[data-cartdel]'); if(!d) return;
    const o = day.orders.find(x=>x.id===d.dataset.cartdel);
    if(o && (o.person===me || confirm(`Odstranim naročilo (${o.person}: ${o.item})?`))){
      await mutate(`/api/days/${day.id}/orders-delete`,{id:d.dataset.cartdel}); toast('Odstranjeno');
      const nd = curDay(); if(nd && nd.orders.length){ cartModal(nd); } else { closeModal(); }
    }
  });
}

function renderCart(day){
  const c = calc(day);
  const by = {};
  for(const o of day.orders) (by[o.person] ||= []).push(o);
  const persons = Object.keys(by).sort((a,b)=> (a===me?-1:b===me?1:a.localeCompare(b)));
  let h = `<aside class="cart" id="cart"><h3>🛒 Naročilo skupine<span class="n">${day.orders.length} ${plural(day.orders.length,'jed','jedi','jedi','jedi')}</span></h3>`;
  if(!day.orders.length) h += `<div class="hint">Še nihče ni nič izbral. Klikni jed v meniju — tukaj bo tvoje naročilo in naročila sodelavcev.</div>`;
  for(const p of persons){
    h += `<div class="person ${p===me?'me':''}">${p===me?'Moje naročilo':esc(p)}</div>`;
    for(const o of by[p]) h += `<div class="line"><span class="q">${o.qty}×</span><span class="nm">${esc(o.item)}${o.options?`<div class="sub">${esc(o.options)}</div>`:''}${o.note?`<div class="sub">✎ ${esc(o.note)}</div>`:''}</span><span class="pr">${fmt(o.price*o.qty)}</span>${canOrder(day)?`<button class="x" data-delorder="${o.id}" title="Odstrani">×</button>`:''}</div>`;
  }
  h += `<div class="tot"><span>Skupaj</span><span>${fmt(c.subtotal)}</span></div>
    <div class="cta">${canOrder(day)?`<button class="btn" data-act="manual">+ Ročni vnos</button>`:''}<button class="btn ghost" data-tab="summary">Povzetek za Wolt ›</button></div></aside>`;
  return h;
}

async function renderMenu(day){
  const slug = day.venue.slug;
  let m;
  try{ m = await loadMenu(slug); }catch(e){ const el=$('#menu'); if(el) el.innerHTML=`<div class="empty">Menija ni šlo naložiti.<br><span class="sub">${esc(e.message)}</span><br><button class="btn" style="margin-top:12px" data-act="manual">+ Ročni vnos</button></div>`; return; }
  const el = $('#menu'); if(!el || curDay()?.id!==day.id) return;
  const open = day.status==='open';
  let html = `<div class="cats">${m.categories.map(c=>`<a data-scroll="cat-${c.id}">${esc(c.name)}</a>`).join('')}</div>`;
  if(!open) html += `<p class="sub">${late?`Rok za naročila (${esc(day.deadline)}) je potekel — kdor naroča, ga lahko podaljša v „Uredi dan“.`:future?`To je predlog za ${dateLong(day.date)}. Meni si lahko ogledaš, naročanje se odpre na ta dan.`:past?'Ta dan je mimo.':'Naročilo je že oddano. Če hočeš kaj dodati, ga najprej ponovno odpri (Naročilo ▾).'}</p>`;
  for(const c of m.categories){
    html += `<h2 class="cat" id="cat-${c.id}">${esc(c.name)}</h2><div class="items">`;
    for(const it of c.items){
      html += `<div class="item ${it.disabled||!open?'off':''}" data-item="${it.id}" data-slug="${esc(slug)}">
        <div class="t"><b>${esc(it.name)}</b><p>${esc(it.description)}</p><span class="p">${fmt(it.price)}</span></div>
        ${it.image?`<img loading="lazy" decoding="async" src="${esc(img(it.image,200))}" alt="">`:''}
        ${!it.disabled&&open?'<div class="plus">+</div>':''}</div>`;
    }
    html += `</div>`;
  }
  el.innerHTML = html;
}
