// ===== FAILSAFE: keep tab navigation working even if other code errors =====
window.addEventListener("error", (e) => {
  // Comment this out later if you don’t want popups
  console.log("App error:", e?.message || e);
});

document.addEventListener("DOMContentLoaded", () => {
  try {
    const tabs = Array.from(document.querySelectorAll(".tab[data-view]"));
    const views = Array.from(document.querySelectorAll("main .view"));

    if (!tabs.length || !views.length) return;

    function show(viewName){
      // tabs
      tabs.forEach(t => t.classList.toggle("active", t.dataset.view === viewName));
      // views
      views.forEach(v => {
        const id = v.id || "";
        const isTarget = id === `view-${viewName}`;
        v.classList.toggle("hidden", !isTarget);
      });
    }

    tabs.forEach(t => {
      t.addEventListener("click", () => show(t.dataset.view));
    });

    // ensure initial tab matches whatever is marked active
    const active = tabs.find(t => t.classList.contains("active")) || tabs[0];
    show(active.dataset.view);
  } catch (err) {
    console.log("Failsafe tabs error:", err);
  }
});/* ===== Backup UI polish wiring (Choose JSON / Import & Replace / Clear / WIPE gate) ===== */
(function wireBackupPolish(){
  const importInput = document.getElementById("importFile");
  const pickBtn = document.getElementById("pickJsonBtn");
  const importBtn = document.getElementById("importConfirmBtn");
  const cancelBtn = document.getElementById("importCancelBtn");
  const fileNameEl = document.getElementById("importFileName");

  const wipeInput = document.getElementById("wipeConfirmInput");
  const resetBtn = document.getElementById("resetBtn");

  // If user isn't on Backup tab or markup isn't present yet, just exit safely
  if(!importInput || !pickBtn || !importBtn || !cancelBtn || !fileNameEl || !wipeInput || !resetBtn) return;

  let pendingFile = null;

  // Open file picker
  pickBtn.addEventListener("click", () => importInput.click());

  // Track selected file
  importInput.addEventListener("change", () => {
    pendingFile = importInput.files && importInput.files[0] ? importInput.files[0] : null;

    if(pendingFile){
      fileNameEl.textContent = pendingFile.name;
      importBtn.disabled = false;
      cancelBtn.disabled = false;
    } else {
      fileNameEl.textContent = "No file selected";
      importBtn.disabled = true;
      cancelBtn.disabled = true;
    }
  });

  // Clear selection
  cancelBtn.addEventListener("click", () => {
    pendingFile = null;
    importInput.value = "";
    fileNameEl.textContent = "No file selected";
    importBtn.disabled = true;
    cancelBtn.disabled = true;
  });

  // Run import (this replaces the old "auto import on choose file" behavior)
  importBtn.addEventListener("click", async () => {
    if(!pendingFile) return;

    const ok = window.confirm(
      `Import will REPLACE local data on this device.\n\nFile: ${pendingFile.name}\n\nProceed?`
    );
    if(!ok) return;

    try{
      const text = await pendingFile.text();
      const json = JSON.parse(text);

      // Use existing app import if available
      if(typeof window.importBackupJson === "function"){
        await window.importBackupJson(json);
      } else if (typeof importBackupJson === "function") {
        await importBackupJson(json);
      } else {
        // Fallback: try to find the existing handler pattern (some builds name it handleImportJson)
        if (typeof window.handleImportJson === "function") {
          await window.handleImportJson(json);
        } else {
          alert("Import function not found in app.js. Paste your import function or tell me your app.js import section and I’ll wire it.");
          return;
        }
      }

      // Reset UI state
      cancelBtn.click();
      // Refresh UI if your app has a render function
      if(typeof window.renderAll === "function") await window.renderAll();
      if(typeof renderAll === "function") await renderAll();

      if(typeof window.toast === "function") window.toast("Import complete.");
      else alert("Import complete.");
    } catch(err){
      console.error(err);
      alert("Import failed. Make sure this is a valid exported JSON backup.");
    }
  });

  // WIPE enable/disable
  const updateWipe = () => {
    resetBtn.disabled = (String(wipeInput.value || "").trim().toUpperCase() !== "WIPE");
  };
  wipeInput.addEventListener("input", updateWipe);
  updateWipe();

  // Gate the existing reset behavior (your app probably already has a click handler on #resetBtn)
  // This handler only runs when enabled; it then asks for confirmation.
  resetBtn.addEventListener("click", async (e) => {
    if(resetBtn.disabled) return;
    const ok = window.confirm("This will wipe ALL local data on this device. Proceed?");
    if(!ok){
      // prevent other handlers from running if user cancels
      e.stopImmediatePropagation();
      e.preventDefault();
      return;
    }
    // If confirmed, allow your existing reset handler to run.
    // If no existing handler exists, do a safe fallback wipe:
    setTimeout(async () => {
      // If app already wiped, this is harmless
      try{
        // Fallback wipe (only if needed)
        if(typeof window.wipeLocalDatabase === "function"){
          await window.wipeLocalDatabase();
        }
      }catch(_){}
    }, 0);
  }, true); // capture = true so cancel stops other handlers
})();
