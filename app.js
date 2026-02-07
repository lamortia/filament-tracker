
// Minimal starter JS (UI skeleton + SW register).
// Next iteration will wire IndexedDB + CRUD for SKUs, snapshots, purchases, spools, print jobs, and insights.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
}
document.getElementById("seedBtn").addEventListener("click", () => alert("Seed defaults (next iteration wires this into storage)."));
document.getElementById("addSkuBtn").addEventListener("click", () => alert("Add SKU (next iteration)."));
document.getElementById("addSnapshotBtn").addEventListener("click", () => alert("Add snapshot (next iteration)."));
document.getElementById("addPurchaseBtn").addEventListener("click", () => alert("Add purchase (next iteration)."));
document.getElementById("addSpoolBtn").addEventListener("click", () => alert("Add spool (next iteration)."));
document.getElementById("addPrintJobBtn").addEventListener("click", () => alert("Log print job (next iteration)."));

document.querySelectorAll(".tab").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    const view = btn.dataset.view;
    document.querySelectorAll(".view").forEach(v=>v.classList.add("hidden"));
    document.getElementById("view-"+view).classList.remove("hidden");
  });
});
