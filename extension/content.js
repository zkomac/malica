// Most med stranjo Malice in razširitvijo. Sprejema samo sporočila iz same strani.
window.addEventListener("message", async (ev) => {
  if (ev.source !== window || !ev.data || ev.data.malicaWolt !== "request") return;
  const { id, payload } = ev.data;
  let result;
  try { result = await chrome.runtime.sendMessage(payload); }
  catch (e) { result = { error: "Razširitev ni odzivna: " + e.message }; }
  window.postMessage({ malicaWolt: "response", id, result }, window.location.origin);
});
window.postMessage({ malicaWolt: "ready", version: chrome.runtime.getManifest().version }, window.location.origin);
