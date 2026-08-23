// Global event wiring and app start-up.
// ---------- dogodki ----------
$('#meSelect').addEventListener('change', async e=>{
  if(e.target.value==='__switch'){ e.target.value=me; welcomeModal(); return; }
  if(e.target.value==='__admin'){ e.target.value=me; adminModal(); return; }
  if(e.target.value==='__logout'){ e.target.value=me; if(confirm('Izhod iz skupine? Za vrnitev boš potreboval/a PIN.')) location.href='/logout'; return; }
  me=e.target.value;
  localStorage.setItem('wolt.me', me); render();
});
$('#locBtn').addEventListener('click', locationModal);
$('#helpBtn').addEventListener('click', helpModal);

document.addEventListener('click', async e=>{
  if(!e.target.closest('[data-act="daymenu"]')) document.querySelectorAll('.dd.open').forEach(d=>d.classList.remove('open'));
  if(e.target.closest('[data-close]') || (e.target.classList.contains('backdrop'))) { closeModal(); return; }
  const sc = e.target.closest('[data-scroll]'); if(sc){ document.getElementById(sc.dataset.scroll)?.scrollIntoView({behavior:'smooth',block:'start'}); return; }
  const pt = e.target.closest('[data-paid-toggle]'); if(pt){ const day=curDay(); const paid=new Set(day.paid); paid.has(pt.dataset.paidToggle)?paid.delete(pt.dataset.paidToggle):paid.add(pt.dataset.paidToggle); await mutate(`/api/days/${day.id}`,{paid:[...paid]}); return; }
  const dd = e.target.closest('[data-delday]'); if(dd){ e.stopPropagation(); const d=state.days.find(x=>x.id===dd.dataset.delday); if(d && confirm(`Izbrišem restavracijo ${d.restaurant} (${dateSl(d.date)})${d.orders.length?` skupaj z ${nOrders(d.orders.length)}`:''}? Tega ni mogoče razveljaviti (admin lahko obnovi prejšnjo različico).`)){ await mutate(`/api/days/${d.id}/delete`,{}); toast('Dan izbrisan'); } return; }
  const t = e.target.closest('[data-new],[data-day],[data-tab],[data-act],[data-edit],[data-delorder],[data-item],[data-focustab]');
  if(!t) return;
  const day = curDay();
  if(t.dataset.new!==undefined){ if(!me){ welcomeModal(); return; } pickerModal(); }
  else if(t.dataset.day){ currentDayId=t.dataset.day; localStorage.setItem('wolt.day',currentDayId); tab = curDay()?.status==='ordered' ? 'split' : 'menu'; render(); }
  else if(t.dataset.tab){ tab=t.dataset.tab; render(); }
  else if(t.dataset.item){ if(t.classList.contains('off')) return; if(!me){ welcomeModal(); return; }
    const m = menus[t.dataset.slug]; const it = m.categories.flatMap(c=>c.items).find(i=>i.id===t.dataset.item); itemModal(it); }
  else if(t.dataset.edit){ manualModal(day.orders.find(o=>o.id===t.dataset.edit)); }
  else if(t.dataset.delorder){ const o=day.orders.find(x=>x.id===t.dataset.delorder); if(o && (o.person===me || confirm(`Odstranim naročilo (${o.person}: ${o.item})?`))) { await mutate(`/api/days/${day.id}/orders-delete`,{id:t.dataset.delorder}); toast('Odstranjeno'); } }
  else if(t.dataset.act==='cart'){ cartModal(day); }
  else if(t.dataset.act==='manual'){ if(!me){ welcomeModal(); return; } if(!canOrder(day)){ toast('Naročila so zaprta'); return; } manualModal(); }
  else if(t.dataset.act==='daymenu'){ e.stopPropagation(); t.parentElement.classList.toggle('open'); return; }
  else if(t.dataset.act==='woltpush-go'){ tab='summary'; render(); setTimeout(()=>{ const b=$('#woltPushBtn'); if(b){ b.scrollIntoView({behavior:'smooth',block:'center'}); b.click(); } },50); }
  else if(t.dataset.act==='wolttotal-go'){ tab='summary'; render(); setTimeout(()=>{ const b=$('#woltTotalBtn'); if(b){ b.scrollIntoView({behavior:'smooth',block:'center'}); b.click(); } },50); }
  else if(t.dataset.act==='finish' || t.dataset.act==='edit-fees'){ finishModal(day); }
  else if(t.dataset.act==='status'){ await mutate(`/api/days/${day.id}`,{status:t.dataset.v}); tab = t.dataset.v==='ordered' ? 'split' : 'menu'; render(); }
  else if(t.dataset.act==='editday'){ editDayModal(day); }
  else if(t.dataset.act==='history'){ historyModal(); }
  else if(t.dataset.act==='copyorder'){ await navigator.clipboard.writeText($('#orderLink').value); toast('Povezava kopirana'); }
  else if(t.dataset.focustab){ e.preventDefault(); const r=await extCall({type:'focusTab', tabId:+t.dataset.focustab}); if(r?.error) window.open(t.href,'_blank','noopener'); }
  else if(t.dataset.act==='woltpush'){ const b=$('#woltPushBtn'); b.disabled=true; b.textContent='Pošiljam v Wolt…';
    const r = await extCall({type:'push', dayId: day.id, who: me}); const out=$('#woltPushResult'); if(!out){ return; }
    if(r.error){ const needLogin=/wolt\.com|prijav/i.test(r.error); out.innerHTML=`<div class="banner" style="background:#fdecea;border-color:#f5c6c2"><div><b>✗ ${esc(r.error)}</b></div>${needLogin?`<a class="btn primary" href="https://wolt.com/sl/login" target="_blank" rel="noopener">Prijava na Woltu ↗</a>`:''}</div>`; b.disabled=false; b.textContent='🛒 Poskusi znova'; }
    else { out.innerHTML=`<div class="banner ok"><div><b>✓ V košarici pri ${esc(r.restaurant)}: ${r.pushed} ${plural(r.pushed,'jed','jedi','jedi','jedi')}</b>${r.lines?`<div class="sub">${r.lines.map(l=>`${l.count}× ${esc(l.name)}`).join(' · ')}</div>`:''}${r.skipped.length?`<div class="sub" style="color:var(--red)">Dodaj ročno (ni z Wolta): ${r.skipped.map(esc).join('; ')}</div>`:''}</div><a class="btn primary" href="${esc(r.url)}" target="_blank" rel="noopener" data-focustab="${r.tabId||''}">Odpri Wolt, preveri in plačaj ↗</a>${r.tabId?`<div class="sub" style="margin-top:6px">Wolt se je odprl v novem zavihku s polno košarico. Če je na Woltu kaj zmotilo (npr. okno starega naročila), klikni <b>Pošlji znova</b> — košarica se samo zamenja.</div>`:''}</div>`; b.disabled=false; b.textContent='🔁 Pošlji znova v Wolt košarico'; }
  }
  else if(t.dataset.act==='wolttotal'){ const b=$('#woltTotalBtn'); b.disabled=true; b.textContent='Berem iz Wolta…';
    const r = await extCall({type:'lastOrder', dayId: day.id, who: me}); const out=$('#woltTotalResult'); if(!out) return;
    if(r.error){ out.innerHTML=`<div class="banner" style="background:#fdecea;border-color:#f5c6c2"><div><b>✗ ${esc(r.error)}</b><div class="sub">Znesek lahko vpišeš tudi sam: Naročilo ▾ → Zaključi naročilo.</div></div></div>`; b.disabled=false; b.textContent='💶 Poskusi znova'; }
    else { out.innerHTML=`<div class="banner ok"><div><b>✓ Wolt: plačano ${fmt(r.total)}</b><div class="sub">jedi ${fmt(r.items)} · dostava ${fmt(r.delivery)}${r.tip?` · napitnina ${fmt(r.tip)}`:''} · ${esc(r.time||'')}</div></div></div>`; b.textContent='✓ Prebrano'; finishModal({...day, grandTotal:r.total, payer: day.payer||me}); }
  }
  else if(t.dataset.act==='copy'){ await navigator.clipboard.writeText($('#summaryText').textContent); toast('Kopirano'); }
});

document.addEventListener('change', async e=>{
  if(e.target.dataset.orderer!==undefined){ const day=curDay(); await mutate(`/api/days/${day.id}`,{orderer:e.target.value, payer: day.payer || e.target.value}); toast(e.target.value?`Na Woltu naroča ${e.target.value}`:'Kdo naroča: ni določeno'); return; }
  if(e.target.dataset.paid!==undefined && e.target.type==='checkbox'){
    const day = curDay(); const paid = new Set(day.paid);
    e.target.checked ? paid.add(e.target.dataset.paid) : paid.delete(e.target.dataset.paid);
    await mutate(`/api/days/${day.id}`,{paid:[...paid]});
  }
});
document.addEventListener('submit', async e=>{
  e.preventDefault();
});
document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeModal(); });

refresh();
setInterval(()=>{ if(orderRoute()) return; if(!$('#modalRoot').children.length && !['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)) refresh(); }, 6000);
