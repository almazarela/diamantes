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

  // Tabla de perfiles en Supabase (columnas: id, email, full_name, avatar_url, is_admin, created_at + saldo_usd de profiles.sql)
  TABLA_PERFILES: "profiles",
  COL_ID: "id",
  COL_EMAIL: "email",
  COL_NOMBRE: "full_name",
  COL_ADMIN: "is_admin",
  COL_SALDO: "saldo_usd",

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

function pintarJugador(data, id, validado) {
  const card = $("player-card");
  const real = validado ? String(nombreDe(data)) : "";
  $("player-name").textContent = validado ? (real.startsWith("@") ? real : "@" + real) : "ID " + id;

  const meta = [];
  if (validado) {
    if (data.nivel || data.level) meta.push("Nivel " + (data.nivel || data.level));
    if (data.region) meta.push(data.region);
    meta.push("ID " + id);
  } else {
    meta.push("Confirmá que este ID sea el correcto antes de pagar");
  }
  $("player-meta").textContent = meta.join(" · ");

  // Mismo diseño verde en ambos casos; solo "Jugador verificado" se usa si n8n confirmó un nombre real
  card.querySelector(".player-label").textContent = validado ? "Jugador verificado" : "ID listo para recargar";

  const img = $("player-avatar-img");
  const avatar = card.querySelector(".player-avatar");
  const urlAvatar = validado && (data.avatar || data.avatar_url);
  if (urlAvatar && /^https:\/\//i.test(urlAvatar)) {
    img.src = urlAvatar;
    img.hidden = false;
    avatar.classList.add("con-img");
    img.onerror = () => { img.hidden = true; avatar.classList.remove("con-img"); };
  } else {
    img.hidden = true;
    avatar.classList.remove("con-img");
  }

  const banner = validado && (data.banner || data.banner_url);
  if (banner && /^https:\/\//i.test(banner)) {
    card.style.setProperty("--banner", `url("${encodeURI(banner)}")`);
    card.classList.add("con-banner");
  } else {
    card.classList.remove("con-banner");
  }
  card.hidden = false;
}

const nombreDe = (d) => d && (d.nombre || d.name || d.nickname || d.nick);

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

  // Si no se puede validar el nombre, el ID igual queda cargado para el pedido (modo manual)
  const modoManual = (motivo) => {
    console.warn("Verificación automática no disponible:", motivo);
    pintarJugador({}, id, false);
    jugadorVerificado = { id, nombre: null, validado: false };
    estadoVerificacion("ID cargado. Revisá que sea correcto antes de comprar.", "ok");
  };

  try {
    const res = await postWebhook({ tipo_evento: "VERIFICAR_JUGADOR", id_jugador: id });
    if (!res.ok) return modoManual("HTTP " + res.status);

    let data = null;
    try { data = await res.json(); } catch (_) { return modoManual("respuesta sin JSON"); }
    if (Array.isArray(data)) data = data[0];   // n8n a veces responde con un array

    // n8n puede avisar explícitamente que el ID no existe
    if (data && (data.encontrado === false || data.found === false)) {
      estadoVerificacion("Jugador no encontrado. Revisá el ID.", "error");
      return;
    }
    if (!nombreDe(data)) return modoManual("el webhook no devolvió nombre");

    pintarJugador(data, id, true);
    jugadorVerificado = { id, nombre: nombreDe(data), validado: true };
    estadoVerificacion("ID verificado correctamente.", "ok");
  } catch (err) {
    modoManual(err.name === "AbortError" ? "timeout" : err.message || err);
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
  const nombre = jugadorVerificado && jugadorVerificado.validado && jugadorVerificado.id === id ? ` (${jugadorVerificado.nombre})` : "";
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
  if (!user) detenerPollAdmin();
  usuarioActual = user;
  const logueado = !!user;
  const esAdminEmail = logueado && (user.email || "").toLowerCase() === CONFIG.ADMIN_EMAIL.toLowerCase();

  $("auth-forms").style.display = logueado ? "none" : "block";
  $("user-dashboard").style.display = logueado ? "block" : "none";
  $("admin-panel-section").style.display = esAdminEmail ? "block" : "none";
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
    setTimeout(() => cargarPerfilYSaldo(user, esAdminEmail), 0);
  }
}

function pintarSaldo(n) {
  const v = formatoUSD(n);
  $("header-balance-amount").textContent = v;
  $("menu-wallet-balance").textContent = v + " USD";
  $("user-balance").textContent = v + " USD";
}

let perfilesDisponible = true;   // false si la tabla no existe: no se vuelve a consultar
let saldoDisponible = true;     // false si falta la columna de saldo: no se vuelve a consultar

const tablaNoExiste = (err) =>
  !!err && (err.code === "PGRST205" || err.code === "42P01" || /Could not find the table|relation .* does not exist/i.test(err.message || ""));
const columnaNoExiste = (err) =>
  !!err && (err.code === "42703" || err.code === "PGRST204" || /column .* does not exist|Could not find the .* column/i.test(err.message || ""));

async function cargarPerfilYSaldo(user, esAdminEmail) {
  let esAdmin = esAdminEmail;
  if (perfilesDisponible) {
    try {
      // Solo columnas que existen en tu tabla
      const { data, error } = await supabase
        .from(CONFIG.TABLA_PERFILES)
        .select(`${CONFIG.COL_ID}, ${CONFIG.COL_EMAIL}, ${CONFIG.COL_NOMBRE}, ${CONFIG.COL_ADMIN}`)
        .eq(CONFIG.COL_ID, user.id)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        const nombre = data[CONFIG.COL_NOMBRE] || (user.user_metadata && user.user_metadata.full_name);
        $("user-email-display").textContent = nombre ? `${nombre} (${user.email})` : user.email;
        if (data[CONFIG.COL_ADMIN] === true) esAdmin = true;   // solo visual: los datos los protege RLS
      }
    } catch (err) {
      if (tablaNoExiste(err)) {
        perfilesDisponible = false;
        console.warn(`La tabla ${CONFIG.TABLA_PERFILES} no existe.`);
      } else {
        console.warn("No se pudo leer el perfil:", err.message || err);
      }
    }
  }
  $("admin-panel-section").style.display = esAdmin ? "block" : "none";
  await cargarSaldo(user);
  if (esAdmin) await cargarPanelAdmin();
}

async function cargarSaldo(user) {
  if (!perfilesDisponible || !saldoDisponible) return pintarSaldo(0);
  try {
    const { data, error } = await supabase
      .from(CONFIG.TABLA_PERFILES)
      .select(CONFIG.COL_SALDO)
      .eq(CONFIG.COL_ID, user.id)
      .maybeSingle();
    if (error) throw error;
    pintarSaldo(data ? data[CONFIG.COL_SALDO] : 0);
  } catch (err) {
    if (columnaNoExiste(err)) {
      saldoDisponible = false;
      console.warn(`Falta la columna ${CONFIG.COL_SALDO} en ${CONFIG.TABLA_PERFILES}: ejecutá profiles.sql.`);
    } else if (tablaNoExiste(err)) {
      perfilesDisponible = false;
    } else {
      console.warn("No se pudo leer el saldo:", err.message || err);
    }
    pintarSaldo(0);
  }
}

function mensajeLista(lista, texto, color) {
  lista.replaceChildren();
  const p = document.createElement("p");
  p.style.cssText = `font-size:12px;color:${color};`;
  p.textContent = texto;
  lista.appendChild(p);
}

async function cargarPanelAdmin() {
  const lista = $("admin-users-list");
  const vista = $("admin-chat-view");
  if (!lista) return;
  if (!perfilesDisponible) return mensajeLista(lista, "Falta la tabla de perfiles en Supabase.", "#f3ba2f");

  const base = [CONFIG.COL_ID, CONFIG.COL_EMAIL, CONFIG.COL_NOMBRE, CONFIG.COL_ADMIN];
  let data = null, error = null;
  for (let intento = 0; intento < 2; intento++) {
    const cols = saldoDisponible ? [...base, CONFIG.COL_SALDO] : base;
    ({ data, error } = await supabase
      .from(CONFIG.TABLA_PERFILES)
      .select(cols.join(", "))
      .order(CONFIG.COL_EMAIL, { ascending: true })
      .limit(100));
    if (error && columnaNoExiste(error) && saldoDisponible) { saldoDisponible = false; continue; }  // reintenta sin saldo
    break;
  }

  if (error) {
    if (tablaNoExiste(error)) {
      perfilesDisponible = false;
      return mensajeLista(lista, "Falta la tabla de perfiles en Supabase.", "#f3ba2f");
    }
    console.warn("No se pudo cargar el panel admin:", error.message || error);
    return mensajeLista(lista, "No se pudo cargar la lista (revisá las políticas RLS).", "#ff5c5c");
  }
  if (!data || !data.length) return mensajeLista(lista, "Sin clientes todavía.", "#666");

  lista.replaceChildren();
  data.forEach((fila) => {
    const etiqueta = fila[CONFIG.COL_NOMBRE] || fila[CONFIG.COL_EMAIL] || String(fila[CONFIG.COL_ID]).slice(0, 8);
    const saldoTxt = saldoDisponible ? " · " + formatoUSD(fila[CONFIG.COL_SALDO]) : "";
    const b = document.createElement("button");
    b.textContent = `${etiqueta}${fila[CONFIG.COL_ADMIN] ? " ★" : ""}${saldoTxt}`;
    b.style.cssText = "display:block;width:100%;text-align:left;margin-bottom:6px;padding:8px;background:#161822;color:#fff;border:1px solid #2b3544;border-radius:6px;cursor:pointer;font-size:12px;";
    b.addEventListener("click", () => seleccionarCliente(fila, b, etiqueta));
    lista.appendChild(b);
  });
}

// ------------------------- PANEL ADMIN: MENSAJES Y SALDO ---------------
const MSG = {
  tabla: "messages",
  userCol: "user_id",        // dueño de la conversación (el cliente)
  senderCol: "sender_id",    // quién envió ese mensaje
  textoCol: "content",
  archivoCol: "file_url",
  leidoCol: "is_read",
  fechaCol: "created_at",
  bucket: "",                // solo si file_url guarda una ruta de Storage en vez de una URL completa
};
const RPC_SALDO = "admin_ajustar_saldo";

let clienteSel = null;      // { id, etiqueta, saldo, btn }
let pollAdmin = null;
let firmaMsgs = "";

function detenerPollAdmin() { clearInterval(pollAdmin); pollAdmin = null; clienteSel = null; }

// Mensaje del cliente: lo envió el mismo usuario dueño de la conversación (o no tiene remitente).
// Cualquier otro remitente (vos, el admin) se muestra como respuesta del administrador.
function esDelAdmin(fila) {
  const remitente = fila[MSG.senderCol];
  return !!remitente && remitente !== fila[MSG.userCol];
}

// Solo https o imágenes data: (evita javascript: y otros esquemas)
function urlSegura(v) {
  if (typeof v !== "string") return null;
  if (/^https:\/\//i.test(v)) return v;
  if (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(v)) return v;
  return null;
}

async function abrirImagen(url) {
  try {
    if (url.startsWith("data:")) {
      const blob = await (await fetch(url)).blob();   // Chrome bloquea abrir data: directamente
      window.open(URL.createObjectURL(blob), "_blank");
    } else {
      window.open(url, "_blank", "noopener");
    }
  } catch (err) { mostrarAviso("No se pudo abrir la imagen.", "error"); }
}

function creaBoton(texto, estilo) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = texto;
  b.style.cssText = "padding:9px 14px;border:none;border-radius:6px;font-weight:700;cursor:pointer;font-size:13px;" + estilo;
  return b;
}
const ESTILO_INPUT = "padding:9px;border-radius:6px;border:1px solid #2b3544;background:#161822;color:#fff;font-size:13px;min-width:0;";

function seleccionarCliente(fila, btn, etiqueta) {
  document.querySelectorAll("#admin-users-list button").forEach((x) => (x.style.borderColor = "#2b3544"));
  btn.style.borderColor = "#f3ba2f";
  clienteSel = {
    id: fila[CONFIG.COL_ID],
    etiqueta,
    email: fila[CONFIG.COL_EMAIL] || "-",
    saldo: saldoDisponible ? Number(fila[CONFIG.COL_SALDO]) || 0 : null,
    btn,
  };
  firmaMsgs = "";
  construirVistaCliente();
  refrescarMensajes(true);
  clearInterval(pollAdmin);
  pollAdmin = setInterval(() => { if (!document.hidden) refrescarMensajes(false); }, 8000);
}

function construirVistaCliente() {
  const vista = $("admin-chat-view");
  vista.replaceChildren();
  vista.style.justifyContent = "flex-start";

  const cab = document.createElement("div");
  cab.style.cssText = "font-size:13px;color:#ddd;margin-bottom:10px;word-break:break-all;";
  const nombre = document.createElement("strong");
  nombre.textContent = clienteSel.etiqueta;
  const sub = document.createElement("div");
  sub.style.cssText = "font-size:11px;color:#888;";
  sub.textContent = clienteSel.email + " · " + clienteSel.id;
  cab.append(nombre, sub);
  vista.appendChild(cab);

  // --- Saldo ---
  if (clienteSel.saldo !== null) {
    const caja = document.createElement("div");
    caja.style.cssText = "background:#161822;border:1px solid #2b3544;border-radius:8px;padding:10px;margin-bottom:10px;";
    const saldoTxt = document.createElement("div");
    saldoTxt.id = "admin-saldo-actual";
    saldoTxt.style.cssText = "font-size:13px;color:#2ecc71;font-weight:700;margin-bottom:8px;";
    saldoTxt.textContent = "Saldo actual: " + formatoUSD(clienteSel.saldo);

    const fila = document.createElement("div");
    fila.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;";
    const modo = document.createElement("select");
    modo.id = "admin-modo";
    modo.style.cssText = ESTILO_INPUT;
    [["sumar", "Sumar / restar"], ["establecer", "Establecer total"]].forEach(([v, t]) => {
      const o = document.createElement("option"); o.value = v; o.textContent = t; modo.appendChild(o);
    });
    const monto = document.createElement("input");
    monto.id = "admin-monto"; monto.type = "number"; monto.step = "0.01"; monto.placeholder = "Monto USD";
    monto.style.cssText = ESTILO_INPUT + "width:110px;";
    const nota = document.createElement("input");
    nota.id = "admin-nota"; nota.type = "text"; nota.maxLength = 120; nota.placeholder = "Nota (opcional)";
    nota.style.cssText = ESTILO_INPUT + "flex:1;min-width:120px;";
    const ok = creaBoton("Acreditar / Cargar Saldo", "background:#2ecc71;color:#000;");
    ok.id = "admin-btn-saldo";
    ok.addEventListener("click", ajustarSaldoCliente);
    fila.append(modo, monto, nota, ok);
    caja.append(saldoTxt, fila);
    vista.appendChild(caja);
  }

  // --- Conversación ---
  const msgs = document.createElement("div");
  msgs.id = "admin-msgs";
  msgs.style.cssText = "background:#0b0c12;border-radius:8px;padding:8px;height:240px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;margin-bottom:8px;";
  const cargando = document.createElement("p");
  cargando.style.cssText = "font-size:12px;color:#666;margin:auto;";
  cargando.textContent = "Cargando mensajes…";
  msgs.appendChild(cargando);
  vista.appendChild(msgs);

  // --- Responder ---
  const resp = document.createElement("div");
  resp.style.cssText = "display:flex;gap:6px;";
  const inp = document.createElement("input");
  inp.id = "admin-respuesta"; inp.type = "text"; inp.placeholder = "Responder al cliente…"; inp.maxLength = 1000;
  inp.style.cssText = ESTILO_INPUT + "flex:1;";
  const env = creaBoton("Enviar", "background:#f3ba2f;color:#000;");
  env.id = "admin-btn-responder";
  const enviar = () => responderCliente();
  env.addEventListener("click", enviar);
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") enviar(); });
  resp.append(inp, env);
  vista.appendChild(resp);
}

async function pedirMensajes(userId) {
  // Los 200 más recientes, mostrados del más viejo al más nuevo
  const r = await supabase
    .from(MSG.tabla)
    .select(`id, ${MSG.userCol}, ${MSG.senderCol}, ${MSG.textoCol}, ${MSG.archivoCol}, ${MSG.leidoCol}, ${MSG.fechaCol}`)
    .eq(MSG.userCol, userId)
    .order(MSG.fechaCol, { ascending: false })
    .limit(200);
  if (!r.error) r.data = (r.data || []).reverse();
  return r;
}

async function refrescarMensajes(forzar) {
  const sel = clienteSel;
  const cont = $("admin-msgs");
  if (!sel || !cont) return;
  const { data, error } = await pedirMensajes(sel.id);
  if (clienteSel !== sel) return;   // el admin cambió de cliente mientras cargaba

  if (error) {
    console.warn("No se pudieron leer los mensajes:", error.message || error);
    if (forzar) {
      cont.replaceChildren();
      const p = document.createElement("p");
      p.style.cssText = "font-size:12px;color:#ff5c5c;margin:auto;text-align:center;";
      p.textContent = tablaNoExiste(error)
        ? "La tabla de mensajes no existe."
        : "No se pudieron cargar los mensajes (revisá las políticas RLS de messages).";
      cont.appendChild(p);
    }
    return;
  }

  const filas = data || [];
  const ultima = filas[filas.length - 1];
  const firma = filas.length + "|" + (ultima ? JSON.stringify(ultima).length : 0);
  if (!forzar && firma === firmaMsgs) return;   // sin novedades: no tocar el scroll
  firmaMsgs = firma;

  const alFinal = cont.scrollHeight - cont.scrollTop - cont.clientHeight < 40 || forzar;
  cont.replaceChildren();
  if (!filas.length) {
    const p = document.createElement("p");
    p.style.cssText = "font-size:12px;color:#666;margin:auto;";
    p.textContent = "Este cliente todavía no envió mensajes.";
    cont.appendChild(p);
    return;
  }

  filas.forEach((f) => {
    const mio = esDelAdmin(f);
    const burbuja = document.createElement("div");
    burbuja.style.cssText =
      "max-width:80%;padding:7px 10px;border-radius:10px;font-size:13px;word-break:break-word;color:#fff;" +
      (mio ? "align-self:flex-end;background:#7a5a00;" : "align-self:flex-start;background:#1f2937;");

    const texto = f[MSG.textoCol];
    if (texto) {
      const t = document.createElement("div");
      t.textContent = String(texto);
      burbuja.appendChild(t);
    }

    const archivo = f[MSG.archivoCol];
    if (archivo) {
      const conectar = (u) => {
        const img = document.createElement("img");
        img.alt = "Comprobante";
        img.style.cssText = "display:block;max-width:100%;max-height:180px;margin-top:6px;border-radius:6px;cursor:zoom-in;";
        img.addEventListener("click", () => abrirImagen(u));
        // Si no es una imagen (ej. un PDF), se reemplaza por un enlace
        img.addEventListener("error", () => {
          const a = document.createElement("a");
          a.href = u; a.target = "_blank"; a.rel = "noopener noreferrer";
          a.textContent = "📎 Ver archivo adjunto";
          a.style.cssText = "display:inline-block;margin-top:6px;color:#7fd1ff;font-size:12px;";
          img.replaceWith(a);
        });
        img.src = u;
        burbuja.appendChild(img);
      };
      const url = urlSegura(archivo);
      if (url) conectar(url);
      else if (MSG.bucket && typeof archivo === "string") {
        supabase.storage.from(MSG.bucket).createSignedUrl(archivo, 3600)
          .then(({ data: d }) => { if (d && d.signedUrl) conectar(d.signedUrl); });
      } else {
        const aviso = document.createElement("div");
        aviso.style.cssText = "font-size:11px;color:#f3ba2f;margin-top:4px;";
        aviso.textContent = "📎 Archivo adjunto (ruta sin URL pública)";
        burbuja.appendChild(aviso);
      }
    }
    if (!texto && !archivo) burbuja.textContent = "(mensaje sin contenido)";

    if (f[MSG.fechaCol]) {
      const h = document.createElement("div");
      h.style.cssText = "font-size:10px;color:#9aa;margin-top:3px;text-align:right;";
      const d = new Date(f[MSG.fechaCol]);
      h.textContent = isNaN(d) ? "" : d.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
      burbuja.appendChild(h);
    }
    cont.appendChild(burbuja);
  });
  if (alFinal) cont.scrollTop = cont.scrollHeight;
}

async function responderCliente() {
  const sel = clienteSel;
  const inp = $("admin-respuesta");
  const btn = $("admin-btn-responder");
  const texto = inp ? inp.value.trim() : "";
  if (!sel || !texto) return;

  if (!usuarioActual) return mostrarAviso("Tu sesión expiró. Volvé a iniciar sesión.", "error");
  const fila = {
    [MSG.userCol]: sel.id,            // conversación del cliente
    [MSG.senderCol]: usuarioActual.id, // enviado por el admin
    [MSG.textoCol]: texto,
    [MSG.leidoCol]: false,
  };

  btn.disabled = true;
  try {
    const { error } = await supabase.from(MSG.tabla).insert(fila);
    if (error) throw error;
    inp.value = "";
    await refrescarMensajes(true);
  } catch (err) {
    console.error("No se pudo enviar la respuesta:", err);
    mostrarAviso(
      columnaNoExiste(err) ? "Los nombres de columnas de messages no coinciden: ajustá MSG en script.js."
      : err.code === "23503" ? "El administrador no tiene un perfil válido para enviar mensajes."
      : err.code === "42501" ? "Sin permiso para responder: ejecutá admin_panel.sql."
      : "No se pudo enviar la respuesta.",
      "error"
    );
  } finally {
    btn.disabled = false;
  }
}

async function ajustarSaldoCliente() {
  const sel = clienteSel;
  const btn = $("admin-btn-saldo");
  if (!sel || !btn) return;
  const modo = $("admin-modo").value;
  const monto = Math.round(parseFloat($("admin-monto").value) * 100) / 100;
  const nota = $("admin-nota").value.trim();

  if (!Number.isFinite(monto) || monto === 0 && modo === "sumar") return mostrarAviso("Ingresá un monto válido.", "error");
  if (Math.abs(monto) > 100000) return mostrarAviso("El monto es demasiado alto.", "error");
  if (modo === "establecer" && monto < 0) return mostrarAviso("El saldo total no puede ser negativo.", "error");

  const resumen = modo === "sumar"
    ? `${monto >= 0 ? "Sumar" : "Restar"} ${formatoUSD(Math.abs(monto))} a ${sel.etiqueta}`
    : `Establecer el saldo de ${sel.etiqueta} en ${formatoUSD(monto)}`;
  if (!window.confirm(resumen + "?\n\nSaldo actual: " + formatoUSD(sel.saldo))) return;

  btn.disabled = true;
  try {
    const { data, error } = await supabase.rpc(RPC_SALDO, { p_user_id: sel.id, p_monto: monto, p_modo: modo, p_nota: nota || null });
    if (error) throw error;
    const nuevo = Number(data);
    sel.saldo = nuevo;
    $("admin-saldo-actual").textContent = "Saldo actual: " + formatoUSD(nuevo);
    sel.btn.textContent = `${sel.etiqueta}${sel.btn.textContent.includes("★") ? " ★" : ""} · ${formatoUSD(nuevo)}`;
    if (usuarioActual && usuarioActual.id === sel.id) pintarSaldo(nuevo);
    $("admin-monto").value = ""; $("admin-nota").value = "";
    mostrarAviso("Saldo actualizado: " + formatoUSD(nuevo), "ok");
  } catch (err) {
    console.error("Error al ajustar saldo:", err);
    mostrarAviso(
      err.code === "PGRST202" ? "Falta crear la función en Supabase: ejecutá admin_panel.sql."
      : err.code === "42501" ? "No autorizado para modificar saldos."
      : /negativ|check constraint/i.test(err.message || "") ? "El saldo no puede quedar negativo."
      : "No se pudo actualizar el saldo.",
      "error"
    );
  } finally {
    btn.disabled = false;
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
  // TOKEN_REFRESHED / foco de pestaña disparan eventos con el mismo usuario: no recargar todo
  if (user && usuarioActual && user.id === usuarioActual.id) usuarioActual = user;
  else renderSesion(user);
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