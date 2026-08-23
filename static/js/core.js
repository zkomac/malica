// Shared helpers, client state, API access and the bridge to the browser extension.
const $ = (s, r=document) => r.querySelector(s);
const fmt = n => (Math.round((+n||0)*100)/100).toFixed(2).replace('.', ',') + ' €';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const DN = ['ned','pon','tor','sre','čet','pet','sob'];
const dateSl = iso => { if(!iso) return ''; const d = new Date(iso+'T00:00'); return `${DN[d.getDay()]}, ${d.getDate()}. ${d.getMonth()+1}.`; };
const dateLong = iso => { if(!iso) return ''; const d = new Date(iso+'T00:00'); return `${['nedelja','ponedeljek','torek','sreda','četrtek','petek','sobota'][d.getDay()]}, ${d.getDate()}. ${d.getMonth()+1}. ${d.getFullYear()}`; };
const relDay = iso => { const t=new Date(todayIso()+'T00:00'), d=new Date(iso+'T00:00'); const n=Math.round((d-t)/86400000); return n===0?'Danes':n===1?'Jutri':n===-1?'Včeraj':''; };
const norm = t => String(t||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
const subseq = (q, t) => { let i=0; for(const ch of t){ if(ch===q[i]) i++; if(i===q.length) return true; } return q.length===0; };
const matches = (q, text) => { const T=norm(text); return norm(q).split(/\s+/).filter(Boolean).every(w => T.includes(w) || (w.length>=4 && T.split(/[^a-z0-9]+/).some(tw => tw.length>=w.length-1 && subseq(w,tw)))); };
const img = (u, w=400) => u ? (u.includes('imageproxy.wolt.com') ? `${u}${u.includes('?')?'&':'?'}w=${w}` : u) : '';
const plural = (n, one, two, few, many) => n%100===1?one:n%100===2?two:(n%100===3||n%100===4)?few:many;
const nOrders = n => `${n} ${plural(n,'naročilo','naročili','naročila','naročil')}`;
const deadlinePassed = d => { const m=/^(\d{1,2}):(\d{2})$/.exec(d.deadline||''); if(!m||!d.date) return false; const due=new Date(d.date+'T00:00'); due.setHours(+m[1],+m[2],0,0); return Date.now()>=due.getTime(); };
const serverToday = () => state.today || todayIso();
const isToday = d => d.date===serverToday();
const canOrder = d => d.status==='open' && isToday(d) && !deadlinePassed(d);
const defaultDeadline = (iso) => { if(iso && iso!==todayIso()) return '11:00'; const n=new Date(); if(n.getHours()<11) return '11:00'; const t=new Date(n.getTime()+60*60000); t.setMinutes(t.getMinutes()<30?30:0); if(t.getMinutes()===0) t.setHours(t.getHours()+1); return `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`; };
const todayIso = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

let state = {people:[], days:[], location:{label:''}};
let currentDayId = localStorage.getItem('wolt.day') || null;
let me = localStorage.getItem('wolt.me') || '';
let tab = 'menu';
const menus = {};        // slug -> menu
let venuesCache = null;  // {venues, filters}

function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),1800); }
async function api(path, body, quiet=false){
  const r = await fetch(path, body ? {method:'POST', headers:{'Content-Type':'application/json', 'X-Who': encodeURIComponent(me||'')}, body: JSON.stringify(body)} : undefined);
  if(r.status===401){ location.reload(); throw new Error('PIN'); }
  const j = await r.json().catch(()=>({error:'Napaka strežnika'}));
  if(!r.ok){ if(!quiet) toast(j.error || 'Napaka'); throw new Error(j.error); }
  return j;
}
let firstLoad = true, seq = 0, lastJson = '';
let extReady = false; const extPending = {};
window.addEventListener('message', ev=>{ if(ev.source!==window || !ev.data || !ev.data.malicaWolt) return;
  if(ev.data.malicaWolt==='ready'){ if(!extReady){ extReady=true; render(); if(new URLSearchParams(location.search).get('ext')==='installed'){ toast('✓ Razširitev Malica ↔ Wolt je nameščena'); history.replaceState(null,'',location.pathname); } } }
  if(ev.data.malicaWolt==='response' && extPending[ev.data.id]){ extPending[ev.data.id](ev.data.result); delete extPending[ev.data.id]; } });
const extCall = payload => new Promise(res=>{ const id=Math.random().toString(36).slice(2); extPending[id]=res; window.postMessage({malicaWolt:'request', id, payload}, location.origin); setTimeout(()=>{ if(extPending[id]){ delete extPending[id]; res({error:'Razširitev se ne odziva — osveži stran'}); } }, 60000); });
async function refresh(){ try{ const my = ++seq; const fresh = await api('/api/state', null, true); if(my !== seq) return; // medtem je bil mutate
  const js = JSON.stringify(fresh); if(js === lastJson && !firstLoad) return; lastJson = js; state = fresh;
  if(me && !state.people.includes(me)){ me=''; localStorage.removeItem('wolt.me'); }
  if(firstLoad){ firstLoad=false; const t = state.days.find(d=>d.date===todayIso()); if(t) currentDayId=t.id; if(curDay()?.status==='ordered') tab='split'; if(!me) welcomeModal(); }
  if(!venuesCache && !window.__prefetch){ window.__prefetch=true; setTimeout(()=>{ try{ const c=JSON.parse(sessionStorage.getItem('venues')||'null'); if(c && c.loc===state.location.label && Date.now()-c.t<600000){ venuesCache=c.data; return; } }catch(e){} api('/api/wolt/venues', null, true).then(d=>{ venuesCache=d; try{ sessionStorage.setItem('venues', JSON.stringify({t:Date.now(), loc:state.location.label, data:d})); }catch(e){} }).catch(()=>{}); }, 800); }
  render(); }catch(e){} }
async function mutate(path, body){ const r = await api(path, body); ++seq; state = r; lastJson = JSON.stringify(r); render(); return state; }
function curDay(){ return state.days.find(d=>d.id===currentDayId); }

async function loadMenu(slug){
  if(menus[slug]) return menus[slug];
  const m = await api('/api/wolt/menu?slug='+encodeURIComponent(slug));
  menus[slug] = m; return m;
}
