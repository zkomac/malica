// Dialogs: item options, finish order, manual entry, restaurant picker, welcome, edit day, history, help, location.
// ---------- modali ----------
function openModal(html, wide=false){
  if(!$('#modalRoot').children.length) history.pushState({modal:1}, '');
  $('#modalRoot').innerHTML = `<div class="backdrop"><div class="modal ${wide?'wide':''}"><button class="icon close" data-close>✕</button>${html}</div></div>`;
  return $('.modal');
}
function closeModal(){ if($('#modalRoot').children.length && history.state?.modal){ history.back(); } else { $('#modalRoot').innerHTML=''; } }
window.addEventListener('popstate', ()=>{ $('#modalRoot').innerHTML=''; });

function itemModal(it, existing){
  const day = curDay();
  let qty = existing?.qty || 1;
  const body = `
    ${it.image?`<img class="mimg" src="${esc(img(it.image,900))}" alt="">`:''}
    <div class="body">
      <h2>${esc(it.name)}</h2>
      <p class="desc">${esc(it.description)} <b style="color:var(--ink)">${fmt(it.price)}</b></p>
      <form id="itemForm">
      ${(it.options||[]).map((o,oi)=>`<div class="opt"><h4>${esc(o.name)}</h4><div class="req">${o.min>0?'Obvezno':'Neobvezno'}${o.max>1?` · največ ${o.max}`:''}</div>
        ${o.values.map((v,vi)=>`<label class="v"><input type="${o.max===1?'radio':'checkbox'}" name="opt${oi}" value="${vi}" data-price="${v.price}" ${o.max===1&&o.min>0&&vi===0?'checked':''}> ${esc(v.name)}<span class="pr">${v.price?'+ '+fmt(v.price):''}</span></label>`).join('')}</div>`).join('')}
      <div class="opt"><label>Kdo naroča</label><select name="person">${state.people.map(p=>`<option ${(existing?.person||me)===p?'selected':''}>${esc(p)}</option>`).join('')}</select></div>
      <div class="opt"><label>Opomba za restavracijo</label><input name="note" placeholder="npr. brez čebule" value="${esc(existing?.note||'')}"></div>
      </form>
    </div>
    <div class="foot">
      <div class="stepper"><button type="button" data-q="-1">−</button><span id="qty">${qty}</span><button type="button" data-q="1">+</button></div>
      <button class="btn primary" id="addBtn">Dodaj v naročilo · <span id="tot"></span></button>
    </div>`;
  const modal = openModal(body);
  const unit = () => it.price + [...document.querySelectorAll('#itemForm input:checked')].reduce((a,i)=>a+(+i.dataset.price||0),0);
  const upd = () => { $('#qty').textContent=qty; $('#tot').textContent=fmt(unit()*qty); };
  upd();
  modal.addEventListener('change', upd);
  modal.addEventListener('click', async e=>{
    if(e.target.dataset.q){ qty=Math.max(1, qty+(+e.target.dataset.q)); upd(); }
    if(e.target.closest('#addBtn')){
      const btn = $('#addBtn'); if(btn.disabled) return; btn.disabled = true;
      const f = $('#itemForm');
      for(const [oi,o] of (it.options||[]).entries()){ const n=f.querySelectorAll(`[name=opt${oi}]:checked`).length; if(n<o.min){ btn.disabled=false; toast(`Izberi: ${o.name}`); f.querySelector(`[name=opt${oi}]`).closest('.opt').scrollIntoView({behavior:'smooth',block:'center'}); return; } if(n>o.max){ btn.disabled=false; toast(`${o.name}: največ ${o.max}`); return; } }
      const person = f.person.value; if(!person){ btn.disabled=false; toast('Najprej zgoraj izberi, kdo si'); return; }
      const chosen = [...f.querySelectorAll('input:checked')].map(i=>{ const o=it.options[+i.name.slice(3)]; return o.values[+i.value].name.trim(); }).filter(n=>!/^ne,?\s*hvala/i.test(n)).join(', ');
      const optsById = {}; for(const i of f.querySelectorAll('input:checked')){ const o=it.options[+i.name.slice(3)]; const v=o.values[+i.value]; (optsById[o.id] ||= {id:o.id, values:[]}).values.push({id:v.id, price:v.price}); }
      try{ await mutate(`/api/days/${day.id}/orders`, {id: existing?.id, person, item: it.name, itemId: it.id, price: unit(), basePrice: it.price, opts: Object.values(optsById), qty, note: f.note.value, options: chosen}); }
      catch(err){ btn.disabled=false; return; }
      closeModal(); toast(`✓ ${it.name} dodano`); flashCart();
    }
  });
}

function finishModal(day){
  const c0 = calc(day); const f = day.fees; const people = [...new Set(day.orders.map(o=>o.person))];
  const payer0 = day.payer || day.orderer || me;
  const modal = openModal(`<div class="body">
    <h2>${day.status==='open'?'Zaključi naročilo':'Stroški naročila'}</h2>
    <p class="desc">${esc(day.restaurant)} · ${day.orders.length} ${plural(day.orders.length,'jed','jedi','jedi','jedi')} · ${fmt(c0.subtotal)} · ${people.length} ${plural(people.length,'oseba','osebi','osebe','oseb')}</p>
    <form id="finForm">
      <div class="opt"><h4>Skupni znesek naročila</h4><div class="req">Vpiši, <b>koliko si dejansko plačal na Woltu</b> (z dostavo in vsemi stroški). Razliko do cene jedi razdelimo med vse.</div>
        <div class="row" style="margin-top:8px"><div><label>Skupaj plačano na Woltu (€)</label><input name="grandTotal" type="number" step="0.01" inputmode="decimal" value="${day.grandTotal||''}" placeholder="${fmt(c0.subtotal).replace(' €','')}" style="font-size:1.2rem"></div></div>
        <div class="sub" style="margin-top:6px">Jedi skupaj: ${fmt(c0.subtotal)}. Pusti prazno, če ni bilo nobenih dodatnih stroškov.</div></div>
      <div class="opt"><div class="row">
        <div><label>Plačal na Woltu</label><select name="payer">${state.people.map(p=>`<option ${payer0===p?'selected':''}>${esc(p)}</option>`).join('')}</select></div>
        <div><label>Kako razdelimo doplačilo</label><select name="feeSplit"><option value="proportional" ${day.feeSplit!=='equal'?'selected':''}>sorazmerno (kdor ima dražje, plača več)</option><option value="equal" ${day.feeSplit==='equal'?'selected':''}>enako na osebo</option></select></div>
      </div></div>
      <div class="opt"><h4>Predogled obračuna</h4><div id="finPreview"></div></div>
    </form></div>
    <div class="foot"><button class="btn primary" id="finSave">${day.status==='open'?'Zaključi in pokaži obračun':'Shrani'}</button></div>`);
  const read = () => { const d = Object.fromEntries(new FormData($('#finForm'))); return {...day, grandTotal:+d.grandTotal||0, feeSplit:d.feeSplit, payer:d.payer}; };
  const preview = () => { const d = read(); const c = calc(d);
    $('#finPreview').innerHTML = `<div class="table-wrap"><table><tbody>${c.rows.map(r=>`<tr><td>${esc(r.person)}${r.person===d.payer?'<span class="pill-badge">plačnik</span>':''}</td><td class="num sub">${fmt(r.items)}${c.extra?` + ${fmt(r.share)}`:''}</td><td class="num"><b>${fmt(r.total)}</b></td></tr>`).join('')}
      <tr class="total"><td>Skupaj</td><td class="num sub">${c.extra?`doplačilo ${fmt(c.extra)}`:'brez doplačil'}</td><td class="num">${fmt(c.total)}</td></tr></tbody></table></div>`; };
  preview();
  modal.addEventListener('input', preview); modal.addEventListener('change', preview);
  $('#finSave').addEventListener('click', async ()=>{
    const d = read(); $('#finSave').disabled = true;
    try{ await mutate(`/api/days/${day.id}`, {grandTotal:d.grandTotal, feeSplit:d.feeSplit, payer:d.payer, status:'ordered'}); }catch(e){ $('#finSave').disabled=false; return; }
    closeModal(); tab='split'; render(); toast(day.status==='open'?'✓ Naročilo zaključeno':'✓ Shranjeno');
  });
}

function flashCart(){ const c=$('#cart'); if(!c) return; c.classList.add('flash'); setTimeout(()=>c.classList.remove('flash'),1200); }

function manualModal(existing){
  const day = curDay();
  openModal(`<div class="body"><h2>${existing?'Uredi naročilo':'Ročni vnos'}</h2><p class="desc">Za jedi, ki jih ni v meniju, ali popravek cene.</p>
    <form id="manualForm">
      <div class="opt"><label>Kdo</label><select name="person">${state.people.map(p=>`<option ${(existing?.person||me)===p?'selected':''}>${esc(p)}</option>`).join('')}</select></div>
      <div class="opt"><label>Jed</label><input name="item" required value="${esc(existing?.item||'')}" placeholder="npr. Margherita"></div>
      <div class="opt"><label>Dodatki</label><input name="options" value="${esc(existing?.options||'')}" placeholder="npr. velika, cheddar fries"></div>
      <div class="opt row"><div><label>Cena na kos (€)</label><input name="price" type="number" step="0.01" min="0" required value="${existing?existing.price:''}"></div><div><label>Količina</label><input name="qty" type="number" min="1" value="${existing?.qty||1}"></div></div>
      <div class="opt"><label>Opomba</label><input name="note" value="${esc(existing?.note||'')}"></div>
    </form></div>
    <div class="foot"><button class="btn primary" id="manualSave">Shrani</button></div>`);
  $('#manualSave').addEventListener('click', async ()=>{
    const f = $('#manualForm'); if(!f.reportValidity()) return;
    const d = Object.fromEntries(new FormData(f));
    await mutate(`/api/days/${day.id}/orders`, {...d, id: existing?.id, itemId: existing?.itemId||''});
    closeModal(); toast('✓ Shranjeno'); flashCart();
  });
}

async function pickerModal(){
  openModal(`<div class="picker-head"><h2>Izberi restavracijo</h2>
      <div class="search"><input id="vq" placeholder="Išči restavracijo ali vrsto hrane…" autofocus><button class="clr" id="vclr" hidden>✕</button></div>
      <div class="filters" id="vf"></div></div>
    <div class="picker-body" id="vb"><div class="spinner">Nalagam restavracije z Wolta za lokacijo „${esc(state.location.label)}“…</div></div>`, true);
  let data;
  try{
    if(!venuesCache){ try{ const c=JSON.parse(sessionStorage.getItem('venues')||'null'); if(c && c.loc===state.location.label && Date.now()-c.t<600000) venuesCache=c.data; }catch(e){} }
    if(!venuesCache){ venuesCache = await api('/api/wolt/venues'); try{ sessionStorage.setItem('venues', JSON.stringify({t:Date.now(), loc:state.location.label, data:venuesCache})); }catch(e){} }
    data = venuesCache;
    if(!$('#vb')) return; // uporabnik je medtem zaprl okno
  }
  catch(e){ const vb=$('#vb'); if(vb) vb.innerHTML=`<div class="empty">Restavracij ni šlo naložiti.<br><span class="sub">${esc(e.message)}</span></div>`; return; }
  let q='', filter='', openOnly=false;
  const prev = {}; // slug -> število dni, ko ste že naročali
  for(const d of state.days) if(d.venue?.slug) prev[d.venue.slug] = (prev[d.venue.slug]||0)+1;
  const byRating = (a,b) => (b.online-a.online) || ((b.rating||0)-(a.rating||0));

  $('#vf').innerHTML = `<button class="${openOnly?'on':''}" data-open>🕐 Odprto zdaj</button><button class="on" data-f="">Vse</button>` + data.filters.map(f=>`<button data-f="${esc(f.id)}">${esc(f.name)}</button>`).join('');

  const card = v => `<div class="venue" data-v="${esc(v.slug)}">
      <div class="img">${v.image?`<img loading="lazy" decoding="async" src="${esc(img(v.image,400))}" alt="">`:''}${v.estimate?`<span class="est">${esc(v.estimate)} min</span>`:''}${!v.online?'<div class="off">Zaprto</div>':''}${prev[v.slug]?`<span class="prev">★ že ${prev[v.slug]}×</span>`:''}</div>
      <b>${esc(v.name)}</b><div class="d">${esc(v.description||v.tags.join(', '))}</div>
      <div class="m">${v.rating?`<span class="r">⭐ ${v.rating}</span>`:''}<span>${'€'.repeat(v.priceRange||1)}</span><span>${esc(v.tags.slice(0,3).join(' · '))}</span></div></div>`;

  const list = () => {
    const ok = v => (!openOnly || v.online) && (!filter || v.tags.includes(filter)) && (!q || matches(q, v.name) || matches(q, v.tags.join(' ')+' '+v.description));
    const vs = data.venues.filter(ok).sort(byRating);
    const fav = !q && !filter ? vs.filter(v=>prev[v.slug]).sort((a,b)=>prev[b.slug]-prev[a.slug]) : [];
    let h = '';
    if(fav.length) h += `<h3 class="sec">Tu ste že naročali</h3><div class="venues">${fav.map(card).join('')}</div>`;
    h += `<h3 class="sec">${q||filter?'Zadetki':'Vse restavracije'} <span class="sub">${vs.length}</span></h3>`;
    h += vs.length ? `<div class="venues">${vs.map(card).join('')}</div>` : `<div class="empty">Ni zadetkov${openOnly?' — poskusi izklopiti „Odprto zdaj“':''}.</div>`;
    $('#vb').innerHTML = h; $('#vb').scrollTop = 0;
  };
  list();

  const detail = async slug => {
    const v = data.venues.find(x=>x.slug===slug);
    const t = todayIso(); const rd = relDay(t);
    $('#vb').innerHTML = `<div class="vd">
      <button class="btn" data-back>‹ Nazaj na seznam</button>
      <div class="vd-hero" style="${v.image?`background-image:url('${esc(img(v.image,900))}')`:''}"></div>
      <h2>${esc(v.name)}</h2><div class="sub">${esc(v.description)}</div>
      <div class="meta" style="margin:8px 0 14px">${v.rating?`<span class="rate">⭐ ${v.rating}${v.ratingVolume?` <span class="sub">(${v.ratingVolume})</span>`:''}</span>`:''}${v.estimate?`<span>🛵 ${esc(v.estimate)} min</span>`:''}${v.address?`<span>📍 ${esc(v.address)}</span>`:''}<span>${'€'.repeat(v.priceRange||1)}</span>${!v.online?'<span class="status">Trenutno zaprto</span>':''}<a href="${esc(v.url)}" target="_blank" rel="noopener">Wolt ↗</a></div>
      <div id="vmenu"><div class="spinner">Nalagam meni…</div></div></div>`;
    $('#vb').scrollTop = 0;
    const picked = $('#picked'); picked.hidden = false;
    picked.innerHTML = `<div class="row" style="width:100%">
      <div style="flex:2;min-width:160px"><b>${esc(v.name)}</b><div class="sub">Predlagaj ta dan sodelavcem</div></div>
      <div><label>Datum</label><input type="date" id="pDate" value="${t}"></div>
      <div><label>Rok za naročila</label><input id="pDeadline" type="time" value="${defaultDeadline(t)}"></div>
      <div><label>Na Woltu naroča</label><select id="pOrderer">${state.people.map(p=>`<option ${p===me?'selected':''}>${esc(p)}</option>`).join('')}</select></div>
      <div class="auto"><button class="btn primary" id="pSave">Predlagaj${rd?' za '+rd.toLowerCase():''}</button></div></div>`;
    $('#pDate').addEventListener('change', e=>{ const r=relDay(e.target.value); $('#pSave').textContent = 'Predlagaj' + (r?' za '+r.toLowerCase():' za '+dateSl(e.target.value)); $('#pDeadline').value = defaultDeadline(e.target.value); });
    $('#pSave').addEventListener('click', async ()=>{
      const dup = state.days.find(d=>d.date===$('#pDate').value);
      if(dup && !confirm(`Za ${dateSl(dup.date)} že obstaja predlog: ${dup.restaurant}${dup.orders.length?` (${nOrders(dup.orders.length)})`:''}.

Dodam še en predlog za isti dan?`)) return;
      $('#pSave').disabled = true;
      let s; try{ s = await mutate('/api/days', {date:$('#pDate').value, restaurant:v.name, url:v.url, deadline:$('#pDeadline').value, proposedBy:me, orderer:$('#pOrderer').value, venue:v}); }catch(e){ const b=$('#pSave'); if(b) b.disabled=false; return; }
      currentDayId = s.days[s.days.length-1].id; localStorage.setItem('wolt.day', currentDayId); tab='menu'; closeModal(); render(); toast(`✓ ${v.name} predlagana`);
    });
    try{
      const m = await loadMenu(slug); const el = $('#vmenu'); if(!el || !m) return;
      el.innerHTML = `<div class="cats">${m.categories.map(c=>`<a data-scroll="pk-${c.id}">${esc(c.name)}</a>`).join('')}</div>` +
        m.categories.map(c=>`<h2 class="cat" id="pk-${c.id}">${esc(c.name)}</h2><div class="items">${c.items.map(it=>`<div class="item ${it.disabled?'off':''}"><div class="t"><b>${esc(it.name)}</b><p>${esc(it.description)}</p><span class="p">${fmt(it.price)}</span></div>${it.image?`<img loading="lazy" decoding="async" src="${esc(img(it.image,200))}" alt="">`:''}</div>`).join('')}</div>`).join('');
    }catch(e){ const el=$('#vmenu'); if(el) el.innerHTML=`<div class="empty">Menija ni šlo naložiti.</div>`; }
  };

  $('.modal').insertAdjacentHTML('beforeend', `<div class="picked" id="picked" hidden></div>`);
  $('#vq').addEventListener('input', e=>{ q=e.target.value.trim(); $('#vclr').hidden=!q; list(); });
  $('#vclr').addEventListener('click', ()=>{ q=''; $('#vq').value=''; $('#vclr').hidden=true; list(); $('#vq').focus(); });
  $('#vf').addEventListener('click', e=>{ const b=e.target.closest('button'); if(!b) return;
    if(b.dataset.open!==undefined){ openOnly=!openOnly; b.classList.toggle('on',openOnly); }
    else { filter=b.dataset.f; [...$('#vf').querySelectorAll('[data-f]')].forEach(x=>x.classList.toggle('on', x===b)); }
    list(); });
  $('#vb').addEventListener('click', e=>{
    if(e.target.closest('[data-back]')){ $('#picked').hidden=true; list(); return; }
    const el = e.target.closest('[data-v]'); if(el) detail(el.dataset.v);
  });
}

function welcomeModal(){
  if($('.welcome')) return;
  openModal(`<div class="body welcome"><h2>👋 Živjo!</h2><p class="desc">Kdo si? Klikni svoje ime ali ga dopiši.</p>
    <div class="names">${state.people.map(p=>`<button type="button" data-pick="${esc(p)}">${esc(p)}</button>`).join('')}</div>
    <form id="welcomeForm" class="row"><div><input name="name" list="peopleList" placeholder="Ime in priimek…" autofocus maxlength="60" autocomplete="off"><datalist id="peopleList">${state.people.map(p=>`<option value="${esc(p)}">`).join('')}</datalist></div><div class="auto"><button class="btn primary">Naprej</button></div></form>
    <p class="sub" style="margin:12px 0 0">Ime si zapomnimo na tej napravi, naslednjič te ne sprašujemo več.</p></div>`);
  const done = () => { closeModal(); render(); if(!localStorage.getItem('wolt.seen')) setTimeout(helpModal, 350); };
  $('.modal').addEventListener('click', e=>{ const b=e.target.closest('[data-pick]'); if(b){ me=b.dataset.pick; localStorage.setItem('wolt.me',me); done(); } });
  $('#welcomeForm').addEventListener('submit', async e=>{ e.preventDefault(); const n=e.target.name.value.trim(); if(!n) return; const hit=state.people.find(p=>p.toLowerCase()===n.toLowerCase()); if(!hit) await mutate('/api/people',{name:n}); me=hit||n; localStorage.setItem('wolt.me',me); done(); });
}

function editDayModal(day){
  const modal = openModal(`<div class="body"><h2>Uredi dan</h2><p class="desc">${esc(day.restaurant)}</p>
    <form id="editDayForm">
      ${day.venue?'':`<div class="opt"><label>Restavracija</label><input name="restaurant" value="${esc(day.restaurant)}" required></div>`}
      <div class="opt row"><div><label>Datum</label><input name="date" type="date" value="${esc(day.date)}" required></div><div><label>Rok za naročila</label><input name="deadline" type="time" value="${esc(day.deadline||'')}"></div></div>
      <div class="opt"><label>Na Woltu naroča</label><select name="orderer"><option value="">—</option>${state.people.map(p=>`<option ${day.orderer===p?'selected':''}>${esc(p)}</option>`).join('')}</select></div>
      <div class="opt"><button type="button" class="btn danger" id="delDay">🗑 Izbriši ta dan z vsemi naročili</button></div>
    </form></div>
    <div class="foot"><button class="btn primary" id="saveDay" style="flex:1">Shrani</button></div>`);
  $('#saveDay').addEventListener('click', async ()=>{ const f=$('#editDayForm'); if(!f.reportValidity()) return; const d=Object.fromEntries(new FormData(f)); await mutate(`/api/days/${day.id}`, d); closeModal(); toast('✓ Shranjeno'); });
  $('#delDay').addEventListener('click', async ()=>{ if(!confirm(`Izbrišem ${day.restaurant} (${dateSl(day.date)}) z vsemi naročili?`)) return; await mutate(`/api/days/${day.id}/delete`,{}); closeModal(); toast('Dan izbrisan'); });
}

function historyModal(){
  const T = todayIso();
  const past = state.days.filter(d=>d.date<T).sort((a,b)=>b.date.localeCompare(a.date));
  const rows = past.map(d=>{ const c=calc(d); return `<div class="day" data-histday="${d.id}" style="min-width:0;width:100%;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;cursor:pointer">
    <div><b>${esc(d.restaurant)}</b><div class="sub">${dateSl(d.date)} · ${nOrders(d.orders.length)}${d.payer?` · plačal ${esc(d.payer)}`:''}</div></div>
    <div style="text-align:right"><b>${fmt(c.total)}</b><div class="sub">${d.status==='ordered'?'naročeno':'osnutek'}</div></div></div>`; }).join('');
  openModal(`<div class="body"><h2>🕘 Zgodovina naročil</h2><p class="desc">Pretekli dnevi. Klikni za podrobnosti in obračun.</p>
    ${past.length?rows:'<p class="sub">Še ni preteklih naročil.</p>'}</div>`);
  $('.modal').addEventListener('click', e=>{ const t=e.target.closest('[data-histday]'); if(t){ currentDayId=t.dataset.histday; localStorage.setItem('wolt.day',currentDayId); tab='split'; closeModal(); render(); } });
}

function helpModal(){
  localStorage.setItem('wolt.seen','1');
  openModal(`<div class="body help"><h2>Kako deluje Malica</h2>
    <ol class="steps">
      <li><span class="n">1</span><div><b>Nekdo predlaga restavracijo</b><div class="sub">Klik na <b>+ Predlagaj restavracijo</b>, izbira z Wolta (iskanje, filtri, predogled menija), datum in rok za naročila.</div></div></li>
      <li><span class="n">2</span><div><b>Vsak izbere svojo jed</b><div class="sub">V zavihku <b>Meni</b> klikneš jed, izbereš dodatke in količino. V košarici desno (na telefonu spodaj) vidiš, kaj naročajo sodelavci.</div></div></li>
      <li><span class="n">3</span><div><b>Ena oseba naroči na Woltu</b><div class="sub">Zavihek <b>Povzetek za Wolt</b> ima seznam s povezavami na vsako jed — samo še doda jih v košarico.</div></div></li>
      <li><span class="n">4</span><div><b>Obračun</b><div class="sub">Kdor naroča, klikne <b>Zaključi naročilo</b>, vpiše dostavo in stroške; aplikacija izračuna, koliko kdo nakaže, in kdo je že poravnal.</div></div></li>
    </ol>
    <p class="sub">Namig: na telefonu stran dodaj na začetni zaslon (Deli → Dodaj na začetni zaslon), pa jo imaš kot aplikacijo.</p>
    </div><div class="foot"><button class="btn primary" data-close style="flex:1">Jasno, gremo!</button></div>`);
}

function locationModal(){
  const l = state.location;
  openModal(`<div class="body"><h2>Lokacija pisarne</h2><p class="desc">Wolt prikaže restavracije, ki dostavljajo na to lokacijo.</p>
    <form id="locForm">
      <div class="opt"><label>Ime</label><input name="label" value="${esc(l.label)}" placeholder="npr. Pisarna, Dunajska 5"></div>
      <div class="opt row"><div><label>Zemljepisna širina (lat)</label><input name="lat" type="number" step="any" value="${l.lat}"></div><div><label>Dolžina (lon)</label><input name="lon" type="number" step="any" value="${l.lon}"></div></div>
      <button type="button" class="btn" id="geo">📍 Uporabi mojo trenutno lokacijo</button>
      <p class="sub">Koordinate dobiš tudi z desnim klikom na Google Maps.</p>
    </form></div>
    <div class="foot"><button class="btn primary" id="locSave">Shrani</button></div>`);
  $('#geo').addEventListener('click', ()=>{ navigator.geolocation?.getCurrentPosition(p=>{ $('#locForm').lat.value=p.coords.latitude.toFixed(5); $('#locForm').lon.value=p.coords.longitude.toFixed(5); }, ()=>toast('Lokacije ni bilo mogoče pridobiti')); });
  $('#locSave').addEventListener('click', async ()=>{ await mutate('/api/location', Object.fromEntries(new FormData($('#locForm')))); venuesCache=null; sessionStorage.removeItem('venues'); closeModal(); toast('Lokacija shranjena'); });
}
