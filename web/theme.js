// Runs before paint; storage can be unavailable in private or embedded browsers.
const media = matchMedia("(prefers-color-scheme: dark)");
let preference = "system";
try { preference = localStorage.getItem("orders-theme") || "system"; } catch { /* Use system. */ }
if (!["system", "light", "dark"].includes(preference)) preference = "system";
function apply() {
  const theme = preference === "system" ? media.matches ? "dark" : "light" : preference;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content = theme === "dark" ? "#1b1d21" : "#f5f6f8";
}
apply();
media.addEventListener("change", apply);
document.addEventListener("DOMContentLoaded", () => {
  const select = document.getElementById("theme");
  select.value = preference;
  select.addEventListener("change", () => {
    preference = select.value;
    try { localStorage.setItem("orders-theme", preference); } catch { /* Keep session choice. */ }
    apply();
  });
});
