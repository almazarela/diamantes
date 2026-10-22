// =====================================================================
//  Centro de Recargas Zarela - script.js (Doble Saldo USD y ARS)
// =====================================================================
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const CONFIG = {
  SUPABASE_URL: "https://egtuaihydqkmaqehgrnd.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_fEVgUFX5bTcoMCqjsT44-A_tgW4pVeZ",
  WEBHOOK_URL: "https://almazarela.app.n8n.cloud/webhook/14200234-eee8-4b90-a4a3-1306b12c377f",
  ADMIN_EMAIL: "almita.zarela@gmail.com",
  WHATSAPP_NUMBER: "54911XXXXXXXX",
  BINANCE_PAY_URL: "",
  MP_PAY_URL: "",
  TABLA_PERFILES: "profiles",
  COL_ID: "id",
  COL_EMAIL: "email",
  COL_NOMBRE: "full_name",
  COL_ADMIN: "is_admin",
  COL_SALDO_USD: "saldo_usd",
  COL_SALDO_ARS: "saldo_ars",
  BUCKET_COMPROBANTES: "comprobantes",
  TIMEOUT_MS: 15000,
};

if (location.hash.startsWith("##")) {
  history.replaceState(null, "", location.pathname + location.search + location.hash.replace(/^#+/, "#"));
}

const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
window.supabaseClient = supabase;

let usuarioActual = null;
let enviandoChat = false;
const $ = (id) => document.getElementById(id);

function mostrarAviso(texto, tipo = "info") {
  const colores = { info: "#009ee3", error: "#ff5c5c", ok: "#2ecc71" };
  const div = document.createElement("div");
  div.textContent = texto;
  div.style.cssText =
    "position:fixed;left:50%;bottom:90px;transform:translateX(-50%);max-width:90%;" +
    "background:#161822;color:#fff;padding:12px 18px;border-radius:10px;font-size:14px;" +
    "z-index:10000;box-shadow:0 4px 20px rgba(0,0,0,.6);border:1px solid " + (colores[tipo] || colores.info);
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 4000);
}

const formatoUSD = (n) => "$" + (Number(n) || 0).toFixed(2);
const formatoARS = (n) => "ARS $" + (Number(n) || 0).toLocaleString("es-AR");

async function comprarPaqueteSaldo(paqueteId, moneda) {
  if (!usuarioActual) return mostrarAviso("Iniciá sesión para comprar con saldo.", "error");
  const idJugador = ($("player-id")?.value || "").trim();
  if (!/^\d{5,15}$/.test(idJugador)) return mostrarAviso("Ingresá un ID de jugador válido.", "error");
  try {
    const { error } = await supabase.rpc(moneda === "ARS" ? "comprar_paquete_ars" : "comprar_paquete", { p_paquete_id: paqueteId });
    if (error) throw error;
    mostrarAviso("¡Compra realizada con éxito! Diamantes en camino.", "ok");
    await cargarSaldo(usuarioActual);
  } catch (err) {
    mostrarAviso(err.message || "Paquete agotado o saldo insuficiente.", "error");
  }
}

function renderSesion(user) {
  usuarioActual = user;
  const logueado = !!user;
  const esAdmin = logueado && (user.email || "").toLowerCase() === CONFIG.ADMIN_EMAIL.toLowerCase();
  if ($("user-dashboard")) $("user-dashboard").style.display = logueado ? "block" : "none";
  if ($("admin-panel-section")) $("admin-panel-section").style.display = esAdmin ? "block" : "none";
  if (logueado) cargarSaldo(user);
}

async function cargarSaldo(user) {
  try {
    const { data } = await supabase.from(CONFIG.TABLA_PERFILES).select("saldo_usd, saldo_ars").eq("id", user.id).maybeSingle();
    const usd = data ? data.saldo_usd : 0;
    const ars = data ? data.saldo_ars : 0;
    if ($("header-balance-amount")) $("header-balance-amount").textContent = formatoUSD(usd);
    if ($("header-balance-ars")) $("header-balance-ars").textContent = formatoARS(ars);
    if ($("menu-wallet-balance")) $("menu-wallet-balance").textContent = formatoUSD(usd) + " USD";
    if ($("menu-wallet-ars")) $("menu-wallet-ars").textContent = formatoARS(ars);
  } catch (e) { console.warn(e); }
}

window.comprarPaqueteSaldo = comprarPaqueteSaldo;
window.loginConGoogle = async () => {
  await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
};
window.logoutGoogle = async () => {
  await supabase.auth.signOut();
  renderSesion(null);
};