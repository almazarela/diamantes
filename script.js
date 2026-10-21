// =====================================================================
//  Centro de Recargas Zarela - script.js
//  Se carga con <script type="module" src="script.js"></script>
//  Todas las funciones usadas por onclick="" se exponen a window al final.
// =====================================================================
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// ------------------------- CONFIGURACIÓN -----------------------------
const CONFIG = {
  SUPABASE_URL: "https://egtuaihydqkmaqehgrnd.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_fEVgUFX5bTcoMCqjsT44-A_tgW4pVeZ",

  // Webhook de n8n (en producción debe ser /webhook/ y el flujo estar ACTIVADO)
  WEBHOOK_URL: "https://almazarela.app.n8n.cloud/webhook/14200234-eee8-4b90-a4a3-1306b12c377f",

  ADMIN_EMAIL: "almita.zarela@gmail.com",

  // Número de WhatsApp en formato internacional sin "+" ni espacios. ¡COMPLETAR!
  WHATSAPP_NUMBER: "54911XXXXXXXX",

  // Opcional: enlaces de pago. Si quedan vacíos, el pedido se arma por el chat.
  BINANCE_PAY_URL: "",
  MP_PAY_URL: "",

  // Tabla de billetera en Supabase (AJUSTAR a tu esquema real)
  TABLA_PERFILES: "perfiles",
  COL_ID: "id",
  COL_SALDO: "saldo",

  MAX_ARCHIVO_MB: 5,
  TIMEOUT_MS: 15000,
};

// Limpia redirecciones viejas con "##access_token" para que Supabase lea la sesión
if (location.hash.startsWith("##")) {
  history.replaceState(null, "", location.pathname + location.search + location.hash.replace(/^#+/, "#"));
}

const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
window.supabaseClient = supabase;

let usuarioActual = null;
let enviandoChat = false;

// ------------------------- UTILIDADES --------------------------------
const $ = (id) => document.getElementById(id);

function mostrarAviso(texto, tipo = "info") {
  const colores = { info: "#009ee3", error: "#ff5c5c", ok: "#2ecc71" };
  const div = document.createElement("div");
  div.textContent = texto;
  div.setAttribute("role", "status");
  div.style.cssText =
    "position:fixed;left:50%;bottom:90px;transform:translateX(-50%);max-width:90%;" +
    "background:#161822;color:#fff;padding:12px 18px;border-radius:10px;font-size:14px;" +
    "z-index:10000;box-shadow:0 4px 20px rgba(0,0,0,.6);border:1px solid " + (colores[tipo] || colores.info);
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 4000);
}

async function postWebhook(payload, timeoutMs = CONFIG.TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(CONFIG.WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

const formatoUSD = (n) => "$" + (Number(n) || 0).toFixed(2);

// ------------------------- MENÚ LATERAL ------------------------------
function toggleMenu() {
  const menu = $("sidebar-menu");
  const overlay = $("menu-overlay");
  if (!menu || !overlay) return;
  const abierto = menu.classList.toggle("open");
  overlay.classList.toggle("open", abierto);
  document.body.style.overflow = abierto ? "hidden" : "";
}

// ------------------------- MODALES DE SALDO --------------------------
function mostrarModal(id, visible) {
  const el = $(id);
  if (el) el.style.display = visible ? "flex" : "none";
}
function cerrarTodosLosModales() {
  ["modal-seleccion-carga", "modal-binance", "modal-mercadopago"].forEach((id) => mostrarModal(id, false));
}
function abrirModalSeleccionCarga() { cerrarTodosLosModales(); mostrarModal("modal-seleccion-carga", true); }
function cerrarModalSeleccionCarga() { mostrarModal("modal-seleccion-carga", false); }
function abrirModalBinance() { cerrarTodosLosModales(); mostrarModal("modal-binance", true); }
function cerrarModalBinance() { mostrarModal("modal-binance", false); }
function abrirModalMercadoPagoSaldo() { cerrarTodosLosModales(); mostrarModal("modal-mercadopago", true); }
function cerrarModalMercadoPagoSaldo() { mostrarModal("modal-mercadopago", false); }

function prepararMensajeChat(texto) {
  const input = $("chat-user-input");
  if (!input) return;
  input.value = texto;
  input.scrollIntoView({ behavior: "smooth", block: "center" });
  input.focus();
}

function procesarCarga({ inputId, moneda, metodo, url, modalCerrar }) {
  const monto = parseFloat($(inputId)?.value);
  if (!(monto > 0)) return mostrarAviso("Ingresá un monto válido.", "error");
  if (!usuarioActual) {
    cerrarTodosLosModales();
    mostrarAviso("Iniciá sesión con Google para cargar saldo.", "error");
    if (!$("sidebar-menu")?.classList.contains("open")) toggleMenu();
    return;
  }
  if (url) window.open(url, "_blank", "noopener");
  modalCerrar();
  prepararMensajeChat(`Hola! Quiero cargar ${monto} ${moneda} con ${metodo}. Ahora te envío el comprobante.`);
  mostrarAviso("Realizá el pago y enviá el comprobante por el chat.", "ok");
}

function procesarPagoBinanceSeguro() {
  procesarCarga({ inputId: "monto-usdt", moneda: "USD", metodo: "Binance USDT", url: CONFIG.BINANCE_PAY_URL, modalCerrar: cerrarModalBinance });
}
function procesarPagoMPSeguro() {
  procesarCarga({ inputId: "monto-mp", moneda: "ARS", metodo: "Mercado Pago", url: CONFIG.MP_PAY_URL, modalCerrar: cerrarModalMercadoPagoSaldo });
}

// ------------------------- CARRUSEL ----------------------------------
let slideActual = 1;
let timerCarrusel = null;

function renderCarrusel() {
  const slides = document.querySelectorAll("#carousel-track .carousel-slide");
  const dots = document.querySelectorAll("#carousel-dots .dot");
  const n = slides.length;
  if (!n) return;
  slides.forEach((s, i) => {
    const offset = (i - slideActual + n) % n;
    s.classList.remove("active", "prev", "next", "hidden");
    if (offset === 0) s.classList.add("active");
    else if (offset === 1) s.classList.add("next");
    else if (offset === n - 1) s.classList.add("prev");
    else s.classList.add("hidden");
  });
  dots.forEach((d, i) => d.classList.toggle("active", i === slideActual));
}
function moverCarrusel(dir) {
  const n = document.querySelectorAll("#carousel-track .carousel-slide").length;
  if (!n) return;
  slideActual = (slideActual + dir + n) % n;
  renderCarrusel();
  reiniciarAutoplay();
}
function irASlide(i) { slideActual = i; renderCarrusel(); reiniciarAutoplay(); }
function reiniciarAutoplay() {
  clearInterval(timerCarrusel);
  timerCarrusel = setInterval(() => {
    const n = document.querySelectorAll("#carousel-track .carousel-slide").length;
    if (n) { slideActual = (slideActual + 1) % n; renderCarrusel(); }
  }, 5000);
}

// ------------------------- MÉTODO DE PAGO ----------------------------
function seleccionarMetodo(metodo) {
  const esMP = metodo === "mp";
  $("card-mp")?.classList.toggle("active", esMP);
  $("card-binance")?.classList.toggle("active", !esMP);
  const gMP = $("grid-mp");
  const gBN = $("grid-binance");
  if (gMP) gMP.style.display = esMP ? "block" : "none";
  if (gBN) gBN.style.display = esMP ? "none" : "block";
}

// ------------------------- VERIFICAR JUGADOR -------------------------
let jugadorVerificado = null;

function estadoVerificacion(texto, clase) {
  const el = $("verify-status");
  if (!el) return;
  el.textContent = texto;
  el.className = "verify-status" + (clase ? " " + clase : "");
}

function pintarJugador(data, id) {
  const card = $("player-card");
  const nombre = data.nombre || data.name || data.nickname || data.nick;
  $("player-name").textContent = nombre;
  const meta = [];
  if (data.nivel || data.level) meta.push("Nivel " + (data.nivel || data.level));
  if (data.region) meta.push(data.region);
  meta.push("ID " + id);
  $("player-meta").textContent = meta.join(" · ");

  const img = $("player-avatar-img");
  const avatar = card.querySelector(".player-avatar");
  const urlAvatar = data.avatar || data.avatar_url;
  if (urlAvatar && /^https:\/\//i.test(urlAvatar)) {
    img.src = urlAvatar;
    img.hidden = false;
    avatar.classList.add("con-img");
    img.onerror = () => { img.hidden = true; avatar.classList.remove("con-img"); };
  } else {
    img.hidden = true;
    avatar.classList.remove("con-img");
  }

  const banner = data.banner || data.banner_url;
  if (banner && /^https:\/\//i.test(banner)) {
    card.style.setProperty("--banner", `url("${encodeURI(banner)}")`);
    card.classList.add("con-banner");
  } else {
    card.classList.remove("con-banner");
  }
  card.hidden = false;
}

async function verificarJugador() {
  const input = $("player-id");
  const btn = $("btn-verificar");
  const id = (input?.value || "").trim();

  $("player-card").hidden = true;
  jugadorVerificado = null;

  if (!/^\d{5,15}$/.test(id)) {
    estadoVerificacion("Ingresá un ID válido (solo números).", "error");
    input?.focus();
    return;
  }

  btn.disabled = true;
  estadoVerificacion("Verificando ID…", "loading");
  try {
    const res = await postWebhook({ tipo_evento: "VERIFICAR_JUGADOR", id_jugador: id });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const nombre = data && (data.nombre || data.name || data.nickname || data.nick);
    if (!nombre) {
      estadoVerificacion("Jugador no encontrado. Revisá el ID.", "error");
      return;
    }
    pintarJugador(data, id);
    jugadorVerificado = { id, nombre };
    estadoVerificacion("ID verificado correctamente.", "ok");
  } catch (err) {
    console.error("Error al verificar jugador:", err);
    estadoVerificacion(
      err.name === "AbortError" ? "El servidor tardó demasiado. Reintentá." : "No se pudo verificar ahora. Reintentá en unos minutos.",
      "error"
    );
  } finally {
    btn.disabled = false;
  }
}

// ------------------------- BOTONES DE COMPRA (WhatsApp) --------------
function actualizarEnlaceWhatsApp(el, paquete, precio) {
  const id = ($("player-id")?.value || "").trim();
  if (!id) {
    const ev = window.event;
    if (ev) ev.preventDefault();
    mostrarAviso("Primero ingresá tu ID de jugador.", "error");
    $("player-id")?.scrollIntoView({ behavior: "smooth", block: "center" });
    $("player-id")?.focus();
    return;
  }
  const nombre = jugadorVerificado && jugadorVerificado.id === id ? ` (${jugadorVerificado.nombre})` : "";
  const texto = `Hola! Quiero recargar ${paquete} por ${precio}.\nMi ID de Free Fire: ${id}${nombre}`;
  el.href = `https://wa.me/${CONFIG.WHATSAPP_NUMBER}?text=${encodeURIComponent(texto)}`;
  el.rel = "noopener noreferrer";
}

// ------------------------- MÚSICA ------------------------------------
function toggleMusica() {
  const audio = $("musica-fondo");
  const btn = $("btn-musica");
  const icono = $("icono-musica");
  const disco = $("imagen-disco");
  if (!audio) return;

  // Carga diferida: evita 404 en consola si los archivos todavía no están subidos
  if (!audio.getAttribute("src") && audio.dataset.src) audio.src = audio.dataset.src;
  if (disco && !disco.getAttribute("src") && disco.dataset.src) disco.src = disco.dataset.src;

  if (audio.paused) {
    audio.play().then(() => {
      btn.classList.add("reproduciendo");
      icono.className = "fa-solid fa-pause";
    }).catch((err) => {
      console.warn("No se pudo reproducir la música:", err);
      mostrarAviso("No se encontró el archivo de música.", "error");
    });
  } else {
    audio.pause();
    btn.classList.remove("reproduciendo");
    icono.className = "fa-solid fa-play";
  }
}

// ------------------------- CHAT / WEBHOOK ----------------------------
const aBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = reject;
  r.readAsDataURL(file);
});

function agregarMensajeChat(texto, clase) {
  const area = $("chat-messages-container");
  if (!area) return;
  const div = document.createElement("div");
  div.className = "chat-message " + clase;
  div.textContent = texto;
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
}

async function enviarMensajeWebhook() {
  if (enviandoChat) return;
  const inputMensaje = $("chat-user-input");
  const inputArchivo = $("chat-file-input");
  const texto = inputMensaje ? inputMensaje.value.trim() : "";
  const archivo = inputArchivo && inputArchivo.files[0] ? inputArchivo.files[0] : null;
  if (!texto && !archivo) return;

  if (archivo && archivo.size > CONFIG.MAX_ARCHIVO_MB * 1024 * 1024) {
    mostrarAviso(`La imagen supera ${CONFIG.MAX_ARCHIVO_MB} MB.`, "error");
    inputArchivo.value = "";
    return;
  }

  enviandoChat = true;
  try {
    const payload = {
      tipo_evento: "CHAT_MENSAJE",
      user_id: usuarioActual ? usuarioActual.id : null,
      email: usuarioActual ? usuarioActual.email : null,
      text: texto,
      archivo: archivo ? await aBase64(archivo) : "",
      nombre_archivo: archivo ? archivo.name : "",
    };
    const res = await postWebhook(payload, 30000);
    if (!res.ok) throw new Error("HTTP " + res.status);

    if (texto) agregarMensajeChat(texto, "user-msg");
    if (archivo) agregarMensajeChat("📎 Comprobante enviado: " + archivo.name, "user-msg");
    if (inputMensaje) inputMensaje.value = "";

    // Si n8n responde con JSON {reply: "..."} lo mostramos como mensaje del admin
    try {
      const data = await res.json();
      const r = data && (data.reply || data.respuesta);
      if (typeof r === "string" && r) agregarMensajeChat(r, "admin-msg");
    } catch (_) { /* respuesta sin JSON: normal */ }
  } catch (err) {
    console.error("Error al enviar el mensaje:", err);
    mostrarAviso("No se pudo enviar el mensaje. Reintentá.", "error");
  } finally {
    if (inputArchivo) inputArchivo.value = "";
    enviandoChat = false;
  }
}

// ------------------------- AUTENTICACIÓN -----------------------------
async function loginConGoogle() {
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      // URL limpia, sin hash. Debe estar en Supabase > Authentication > Redirect URLs
      options: { redirectTo: location.origin + location.pathname },
    });
    if (error) throw error;
  } catch (err) {
    console.error("Error al iniciar sesión con Supabase:", err);
    mostrarAviso("No se pudo completar el inicio de sesión.", "error");
  }
}

async function logoutGoogle() {
  try { await supabase.auth.signOut(); } catch (err) { console.error(err); }
  renderSesion(null);
}

function renderSesion(user) {
  usuarioActual = user;
  const logueado = !!user;
  const esAdmin = logueado && (user.email || "").toLowerCase() === CONFIG.ADMIN_EMAIL.toLowerCase();

  $("auth-forms").style.display = logueado ? "none" : "block";
  $("user-dashboard").style.display = logueado ? "block" : "none";
  $("admin-panel-section").style.display = esAdmin ? "block" : "none";
  if (logueado) $("user-email-display").textContent = user.email;

  // Sidebar: botón de login o de logout
  const area = $("sidebar-auth-btn-area");
  if (area) {
    area.replaceChildren();
    const btn = document.createElement("button");
    btn.className = "btn-google-login";
    if (logueado) {
      btn.textContent = "Cerrar sesión (" + user.email + ")";
      btn.addEventListener("click", logoutGoogle);
    } else {
      btn.innerHTML = '<i class="fa-brands fa-google" style="color:#ea4335;"></i> Iniciar Sesión con Google';
      btn.addEventListener("click", loginConGoogle);
    }
    area.appendChild(btn);
  }

  $("menu-wallet-id").textContent = logueado ? "#REV-" + user.id.replace(/-/g, "").slice(0, 5).toUpperCase() : "#REV-00000";
  pintarSaldo(0);

  if (logueado) {
    // setTimeout evita bloquear el cliente de Supabase dentro de onAuthStateChange
    setTimeout(() => cargarSaldo(user), 0);
    if (esAdmin) setTimeout(cargarPanelAdmin, 0);
  }
}

function pintarSaldo(n) {
  const v = formatoUSD(n);
  $("header-balance-amount").textContent = v;
  $("menu-wallet-balance").textContent = v + " USD";
  $("user-balance").textContent = v + " USD";
}

async function cargarSaldo(user) {
  try {
    const { data, error } = await supabase
      .from(CONFIG.TABLA_PERFILES)
      .select(CONFIG.COL_SALDO)
      .eq(CONFIG.COL_ID, user.id)
      .maybeSingle();
    if (error) throw error;
    pintarSaldo(data ? data[CONFIG.COL_SALDO] : 0);
  } catch (err) {
    console.warn("No se pudo leer el saldo (revisá tabla/columnas/RLS):", err.message || err);
    pintarSaldo(0);
  }
}

async function cargarPanelAdmin() {
  const lista = $("admin-users-list");
  const vista = $("admin-chat-view");
  if (!lista) return;
  lista.replaceChildren();
  try {
    const { data, error } = await supabase.from(CONFIG.TABLA_PERFILES).select("*").limit(50);
    if (error) throw error;
    if (!data || !data.length) {
      lista.innerHTML = '<p style="font-size:12px;color:#666;">Sin clientes todavía.</p>';
      return;
    }
    data.forEach((fila) => {
      const b = document.createElement("button");
      const etiqueta = fila.email || fila.nombre || String(fila[CONFIG.COL_ID]).slice(0, 8);
      b.textContent = `${etiqueta} · ${formatoUSD(fila[CONFIG.COL_SALDO])}`;
      b.style.cssText = "display:block;width:100%;text-align:left;margin-bottom:6px;padding:8px;background:#161822;color:#fff;border:1px solid #2b3544;border-radius:6px;cursor:pointer;font-size:12px;";
      b.addEventListener("click", () => {
        vista.replaceChildren();
        const p = document.createElement("p");
        p.style.cssText = "font-size:13px;color:#ddd;";
        p.textContent = `Cliente: ${etiqueta} | ID: ${fila[CONFIG.COL_ID]} | Saldo: ${formatoUSD(fila[CONFIG.COL_SALDO])}`;
        vista.appendChild(p);
      });
      lista.appendChild(b);
    });
  } catch (err) {
    console.warn("No se pudo cargar el panel admin:", err.message || err);
    lista.innerHTML = '<p style="font-size:12px;color:#ff5c5c;">No se pudo cargar la lista (revisá tabla y políticas RLS).</p>';
  }
}

function notificarLogin(user) {
  const clave = "loginNotificado:" + user.id;
  try {
    if (sessionStorage.getItem(clave)) return;
    sessionStorage.setItem(clave, "1");
  } catch (_) { /* sessionStorage bloqueado: seguimos igual */ }
  postWebhook({ tipo_evento: "LOGIN", user_id: user.id, email: user.email, fecha: new Date().toISOString() }, 10000)
    .catch((err) => console.warn("No se pudo notificar el login:", err.message || err));
}

supabase.auth.onAuthStateChange((evento, session) => {
  const user = session ? session.user : null;
  renderSesion(user);
  if (user && evento === "SIGNED_IN") {
    notificarLogin(user);
    // Limpia el access_token de la barra de direcciones
    if (location.hash.includes("access_token")) {
      history.replaceState(null, "", location.pathname + location.search);
    }
  }
});

// ------------------------- INICIO ------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  renderCarrusel();
  reiniciarAutoplay();
  $("carousel-wrapper")?.addEventListener("mouseenter", () => clearInterval(timerCarrusel));
  $("carousel-wrapper")?.addEventListener("mouseleave", reiniciarAutoplay);
  $("player-id")?.addEventListener("keydown", (e) => { if (e.key === "Enter") verificarJugador(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { cerrarTodosLosModales(); if ($("sidebar-menu")?.classList.contains("open")) toggleMenu(); }
  });
  // Cerrar modales al tocar el fondo oscuro
  ["modal-seleccion-carga", "modal-binance", "modal-mercadopago"].forEach((id) => {
    $(id)?.addEventListener("click", (e) => { if (e.target.id === id) mostrarModal(id, false); });
  });
});

// ------------------------- EXPOSICIÓN GLOBAL (onclick del HTML) ------
Object.assign(window, {
  toggleMenu,
  abrirModalSeleccionCarga, cerrarModalSeleccionCarga,
  abrirModalBinance, cerrarModalBinance,
  abrirModalMercadoPagoSaldo, cerrarModalMercadoPagoSaldo,
  procesarPagoBinanceSeguro, procesarPagoMPSeguro,
  moverCarrusel, irASlide,
  seleccionarMetodo,
  verificarJugador,
  actualizarEnlaceWhatsApp,
  toggleMusica,
  enviarMensajeWebhook,
  loginConGoogle, logoutGoogle,
});
