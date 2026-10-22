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

  BUCKET_COMPROBANTES: "comprobantes",   // bucket PRIVADO de Storage (lo crea chat_cliente.sql)
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
// Formatos que acepta el bucket de comprobantes
const TIPOS_IMAGEN = ["image/jpeg", "image/png", "image/webp", "image/gif"];

let pollChat = null;
let firmaChat = "";
const cacheUrls = new Map();   // ruta -> { url, vence }

// Devuelve una URL mostrable: https / data:image directas, o una URL firmada si es una ruta del bucket
async function resolverArchivo(valor) {
  const directa = urlSegura(valor);
  if (directa) return directa;
  if (typeof valor !== "string" || !valor) return null;
  const c = cacheUrls.get(valor);
  if (c && c.vence > Date.now()) return c.url;
  const { data, error } = await supabase.storage.from(CONFIG.BUCKET_COMPROBANTES).createSignedUrl(valor, 3600);
  if (error || !data) return null;
  cacheUrls.set(valor, { url: data.signedUrl, vence: Date.now() + 50 * 60 * 1000 });
  return data.signedUrl;
}

function limpiarChatCliente() {
  const cont = $("chat-messages-container");
  if (!cont) return;
  [...cont.children].filter((el) => !el.dataset.fijo).forEach((el) => el.remove());
}

function detenerChatCliente() {
  respuestaPendiente.cliente = null;
  renderBarraRespuesta("cliente");
  renderBarraFijados("cliente", []);
  cerrarMenuMensaje();
  clearInterval(pollChat);
  pollChat = null;
  firmaChat = "";
  limpiarChatCliente();
}

function iniciarChatCliente() {
  clearInterval(pollChat);
  firmaChat = "";
  cargarHistorialCliente(true);
  pollChat = setInterval(() => { if (!document.hidden) cargarHistorialCliente(false); }, 8000);
}

async function cargarHistorialCliente(forzar) {
  const cont = $("chat-messages-container");
  const yo = usuarioActual;
  if (!cont || !yo) return;

  const { data, error } = await consultarMensajes(yo.id);
  if (usuarioActual !== yo) return;   // cerró sesión mientras cargaba
  if (error) {
    if (forzar) console.warn("No se pudo cargar el historial del chat:", error.message || error);
    return;
  }

  const filas = (data || []).reverse();
  const ultima = filas[filas.length - 1];
  const firma = firmaDe(filas);
  if (!forzar && firma === firmaChat) return;
  firmaChat = firma;

  const alFinal = forzar || cont.scrollHeight - cont.scrollTop - cont.clientHeight < 60;
  cerrarMenuMensaje();
  limpiarChatCliente();
  renderBarraFijados("cliente", filas);
  renderBarraRespuesta("cliente");
  for (const f of filas) {
    const div = document.createElement("div");
    div.className = "chat-message " + (esDelAdmin(f) ? "admin-msg" : "user-msg");
    const texto = f[MSG.textoCol];
    if (texto) {
      const t = document.createElement("div");
      t.textContent = String(texto);
      div.appendChild(t);
    }
    if (f[MSG.archivoCol]) {
      const img = document.createElement("img");
      img.alt = "Comprobante";
      img.style.cssText = "display:block;max-width:100%;max-height:200px;margin-top:6px;border-radius:8px;cursor:zoom-in;";
      div.appendChild(img);
      resolverArchivo(f[MSG.archivoCol]).then((u) => {
        if (!u) { img.replaceWith(Object.assign(document.createElement("span"), { textContent: "📎 Comprobante enviado" })); return; }
        img.src = u;
        img.addEventListener("click", () => abrirImagen(u));
        img.addEventListener("error", () => {
          const a = Object.assign(document.createElement("a"), { href: u, target: "_blank", rel: "noopener noreferrer", textContent: "📎 Ver archivo adjunto" });
          img.replaceWith(a);
        });
      });
    }
    if (!texto && !f[MSG.archivoCol]) div.textContent = "(mensaje sin contenido)";
    adornarMensaje(div, f, "cliente", filas);
    cont.appendChild(div);
  }
  if (alFinal) cont.scrollTop = cont.scrollHeight;
}

// Aviso a n8n (notificación al admin). Es opcional: si falla, el mensaje igual quedó guardado.
async function notificarChatN8n(texto, ruta, nombreArchivo) {
  let urlFirmada = null;
  if (ruta) {
    const { data } = await supabase.storage.from(CONFIG.BUCKET_COMPROBANTES).createSignedUrl(ruta, 7 * 24 * 3600);
    urlFirmada = data ? data.signedUrl : null;
  }
  await postWebhook({
    tipo_evento: "CHAT_MENSAJE",
    user_id: usuarioActual.id,
    email: usuarioActual.email,
    text: texto,
    nombre_archivo: nombreArchivo || "",
    file_path: ruta || "",
    archivo_url: urlFirmada || "",
  }, 15000);
}

async function enviarMensajeWebhook() {
  if (enviandoChat) return;
  const inputMensaje = $("chat-user-input");
  const inputArchivo = $("chat-file-input");
  const texto = inputMensaje ? inputMensaje.value.trim() : "";
  const archivo = inputArchivo && inputArchivo.files[0] ? inputArchivo.files[0] : null;
  if (!texto && !archivo) return;

  if (!usuarioActual) {
    mostrarAviso("Iniciá sesión con Google para chatear y enviar comprobantes.", "error");
    if (inputArchivo) inputArchivo.value = "";
    if (!$("sidebar-menu")?.classList.contains("open")) toggleMenu();
    return;
  }
  if (archivo && !TIPOS_IMAGEN.includes(archivo.type)) {
    mostrarAviso("Formato no admitido. Usá JPG, PNG, WebP o GIF.", "error");
    inputArchivo.value = "";
    return;
  }
  if (archivo && archivo.size > CONFIG.MAX_ARCHIVO_MB * 1024 * 1024) {
    mostrarAviso(`La imagen supera ${CONFIG.MAX_ARCHIVO_MB} MB.`, "error");
    inputArchivo.value = "";
    return;
  }

  enviandoChat = true;
  try {
    let ruta = null;
    if (archivo) {
      const ext = (archivo.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
      ruta = `${usuarioActual.id}/${Date.now()}.${ext}`;   // la carpeta = ID del usuario (lo exige la política)
      const { error: errSubida } = await supabase.storage
        .from(CONFIG.BUCKET_COMPROBANTES)
        .upload(ruta, archivo, { contentType: archivo.type, upsert: false });
      if (errSubida) throw errSubida;
    }

    const nuevo = {
      [MSG.userCol]: usuarioActual.id,
      [MSG.senderCol]: usuarioActual.id,
      [MSG.textoCol]: texto,
      [MSG.archivoCol]: ruta,
      [MSG.leidoCol]: false,
    };
    agregarRespuesta(nuevo, "cliente");
    const { error } = await supabase.from(MSG.tabla).insert(nuevo);
    if (error) throw error;

    respuestaPendiente.cliente = null;
    if (inputMensaje) inputMensaje.value = "";
    await cargarHistorialCliente(true);
    notificarChatN8n(texto, ruta, archivo ? archivo.name : "")
      .catch((err) => console.warn("No se pudo avisar a n8n:", err.message || err));
  } catch (err) {
    console.error("Error al enviar el mensaje:", err);
    const msg = String((err && err.message) || "");
    mostrarAviso(
      /bucket not found/i.test(msg) ? "Falta crear el almacenamiento de comprobantes: ejecutá chat_cliente.sql."
      : /row-level security|42501/i.test(msg + (err.code || "")) ? "Sin permiso para enviar: ejecutá chat_cliente.sql."
      : "No se pudo enviar el mensaje. Reintentá.",
      "error"
    );
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
    setTimeout(iniciarChatCliente, 0);
  } else {
    detenerChatCliente();
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

const RPC_RESUMEN = "admin_resumen_actividad";
const RPC_LEIDOS = "admin_marcar_leidos";

let clientesAdmin = [];            // filas de profiles
let resumenAdmin = new Map();      // id -> { ultima (ms), noLeidos }
let resumenDisponible = true;      // false si falta ejecutar admin_actividad.sql
let leidosDisponible = true;
let pollLista = null;
let cargandoLista = false;

function tiempoRelativo(ms) {
  if (!ms) return "sin actividad";
  const min = Math.floor((Date.now() - ms) / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  if (min < 1440) return `hace ${Math.floor(min / 60)} h`;
  if (min < 10080) return `hace ${Math.floor(min / 1440)} d`;
  return new Date(ms).toLocaleDateString("es-AR");
}

async function cargarResumenActividad() {
  if (!resumenDisponible) return;
  const { data, error } = await supabase.rpc(RPC_RESUMEN);
  if (error) {
    if (error.code === "PGRST202") {
      resumenDisponible = false;
      console.warn("Falta la función admin_resumen_actividad: ejecutá admin_actividad.sql para ordenar por actividad y ver no leídos.");
    } else {
      console.warn("No se pudo leer la actividad de clientes:", error.message || error);   // se conserva el resumen anterior
    }
    return;
  }
  resumenAdmin = new Map((data || []).map((r) => [
    r.cliente_id,
    { ultima: r.ultima_actividad ? new Date(r.ultima_actividad).getTime() : 0, noLeidos: Number(r.no_leidos) || 0 },
  ]));
}

// Marca actividad "ahora" para un cliente (respuesta enviada, saldo acreditado) sin esperar al servidor
function tocarActividad(id) {
  const r = resumenAdmin.get(id) || { ultima: 0, noLeidos: 0 };
  r.ultima = Date.now();
  resumenAdmin.set(id, r);
  renderListaClientes();
}

function renderListaClientes() {
  const lista = $("admin-users-list");
  if (!lista) return;
  if (!clientesAdmin.length) return mensajeLista(lista, "Sin clientes todavía.", "#666");

  const dato = (f) => resumenAdmin.get(f[CONFIG.COL_ID]) || { ultima: 0, noLeidos: 0 };
  const filas = [...clientesAdmin].sort((a, b) => {
    const d = dato(b).ultima - dato(a).ultima;   // más reciente arriba
    return d !== 0 ? d : String(a[CONFIG.COL_EMAIL] || "").localeCompare(String(b[CONFIG.COL_EMAIL] || ""));
  });

  const scroll = lista.scrollTop;
  lista.replaceChildren();
  filas.forEach((fila) => {
    const id = fila[CONFIG.COL_ID];
    const { ultima, noLeidos } = dato(fila);
    const seleccionado = clienteSel && clienteSel.id === id;
    const etiqueta = fila[CONFIG.COL_NOMBRE] || fila[CONFIG.COL_EMAIL] || String(id).slice(0, 8);
    const saldoTxt = saldoDisponible ? " · " + formatoUSD(fila[CONFIG.COL_SALDO]) : "";

    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-label", noLeidos ? `${etiqueta}, ${noLeidos} mensajes sin leer` : etiqueta);
    const borde = seleccionado ? "#f3ba2f" : noLeidos ? "#3b82f6" : "#2b3544";
    const fondo = noLeidos ? "#10264a" : "#161822";
    b.style.cssText =
      `display:block;width:100%;text-align:left;margin-bottom:6px;padding:8px;background:${fondo};color:#fff;` +
      `border:1px solid ${borde};border-radius:6px;cursor:pointer;font-size:12px;` +
      (noLeidos ? "box-shadow:0 0 0 1px #3b82f6;" : "");

    const fila1 = document.createElement("div");
    fila1.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:6px;";
    const nombre = document.createElement("span");
    nombre.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" + (noLeidos ? "font-weight:700;" : "");
    nombre.textContent = `${etiqueta}${fila[CONFIG.COL_ADMIN] ? " ★" : ""}${saldoTxt}`;
    fila1.appendChild(nombre);
    if (noLeidos) {
      const badge = document.createElement("span");
      badge.textContent = noLeidos > 99 ? "99+" : String(noLeidos);
      badge.style.cssText = "flex:none;min-width:18px;padding:1px 6px;border-radius:10px;background:#3b82f6;color:#fff;font-size:11px;font-weight:700;text-align:center;";
      fila1.appendChild(badge);
    }
    const fila2 = document.createElement("div");
    fila2.style.cssText = "font-size:10px;color:" + (noLeidos ? "#9ec5ff" : "#888") + ";margin-top:2px;";
    fila2.textContent = noLeidos ? `${noLeidos} sin leer · ${tiempoRelativo(ultima)}` : tiempoRelativo(ultima);
    b.append(fila1, fila2);

    b.addEventListener("click", () => seleccionarCliente(fila, etiqueta));
    lista.appendChild(b);
  });
  lista.scrollTop = scroll;
}

async function cargarPanelAdmin(silencioso = false) {
  const lista = $("admin-users-list");
  if (!lista || cargandoLista) return;
  if (!perfilesDisponible) return silencioso || mensajeLista(lista, "Falta la tabla de perfiles en Supabase.", "#f3ba2f");
  cargandoLista = true;
  try {
    const base = [CONFIG.COL_ID, CONFIG.COL_EMAIL, CONFIG.COL_NOMBRE, CONFIG.COL_ADMIN];
    let data = null, error = null;
    for (let intento = 0; intento < 2; intento++) {
      const cols = saldoDisponible ? [...base, CONFIG.COL_SALDO] : base;
      ({ data, error } = await supabase
        .from(CONFIG.TABLA_PERFILES)
        .select(cols.join(", "))
        .order(CONFIG.COL_EMAIL, { ascending: true })
        .limit(200));
      if (error && columnaNoExiste(error) && saldoDisponible) { saldoDisponible = false; continue; }  // reintenta sin saldo
      break;
    }

    if (error) {
      if (tablaNoExiste(error)) {
        perfilesDisponible = false;
        return silencioso || mensajeLista(lista, "Falta la tabla de perfiles en Supabase.", "#f3ba2f");
      }
      console.warn("No se pudo cargar el panel admin:", error.message || error);
      return silencioso || mensajeLista(lista, "No se pudo cargar la lista (revisá las políticas RLS).", "#ff5c5c");
    }

    clientesAdmin = data || [];
    await cargarResumenActividad();
    renderListaClientes();

    if (!pollLista) {
      pollLista = setInterval(() => { if (!document.hidden) cargarPanelAdmin(true); }, 10000);
    }
  } finally {
    cargandoLista = false;
  }
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
  bucket: CONFIG.BUCKET_COMPROBANTES,   // file_url guarda la ruta del archivo dentro de este bucket
};
const RPC_SALDO = "admin_ajustar_saldo";

let clienteSel = null;      // { id, etiqueta, saldo, btn }
let pollAdmin = null;
let firmaMsgs = "";

function detenerPollAdmin() {
  clearInterval(pollAdmin); pollAdmin = null;
  clearInterval(pollLista); pollLista = null;
  clienteSel = null; clientesAdmin = []; resumenAdmin = new Map();
}

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

function seleccionarCliente(fila, etiqueta) {
  clienteSel = {
    id: fila[CONFIG.COL_ID],
    etiqueta,
    email: fila[CONFIG.COL_EMAIL] || "-",
    saldo: saldoDisponible ? Number(fila[CONFIG.COL_SALDO]) || 0 : null,
    fila,
  };
  respuestaPendiente.admin = null;
  renderListaClientes();   // resalta el cliente elegido
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
  return consultarMensajes(userId);
}

async function marcarLeidos(sel) {
  const { error } = await supabase.rpc(RPC_LEIDOS, { p_user_id: sel.id });
  if (error) {
    if (error.code === "PGRST202") {
      leidosDisponible = false;
      console.warn("Falta la función admin_marcar_leidos: ejecutá admin_actividad.sql.");
    } else {
      console.warn("No se pudo marcar como leído:", error.message || error);
    }
    return;
  }
  const r = resumenAdmin.get(sel.id);
  if (r) { r.noLeidos = 0; renderListaClientes(); }
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
  const firma = firmaDe(filas);
  if (!forzar && firma === firmaMsgs) return;   // sin novedades: no tocar el scroll
  firmaMsgs = firma;

  // Al ver los mensajes del cliente, quedan marcados como leídos
  if (leidosDisponible && filas.some((f) => !esDelAdmin(f) && f[MSG.leidoCol] !== true)) marcarLeidos(sel);

  const alFinal = cont.scrollHeight - cont.scrollTop - cont.clientHeight < 40 || forzar;
  cerrarMenuMensaje();
  cont.replaceChildren();
  renderBarraFijados("admin", filas);
  renderBarraRespuesta("admin");
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
      h.dataset.hora = "1";
      h.style.cssText = "font-size:10px;color:#9aa;margin-top:3px;text-align:right;";
      const d = new Date(f[MSG.fechaCol]);
      h.textContent = isNaN(d) ? "" : d.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
      burbuja.appendChild(h);
    }
    adornarMensaje(burbuja, f, "admin", filas);
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
  agregarRespuesta(fila, "admin");

  btn.disabled = true;
  try {
    const { error } = await supabase.from(MSG.tabla).insert(fila);
    if (error) throw error;
    inp.value = "";
    respuestaPendiente.admin = null;
    tocarActividad(sel.id);
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
    if (sel.fila) sel.fila[CONFIG.COL_SALDO] = nuevo;
    tocarActividad(sel.id);
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

// ------------------------- MENÚ DE MENSAJES (copiar / responder / reaccionar / fijar)
const REACCIONES = ["👍", "❤️", "😂", "😮", "🙏", "✅"];
const RPC_REACCIONAR = "reaccionar_mensaje";
const RPC_FIJAR = "fijar_mensaje";
const COLS_EXTRA = ["reactions", "reply_to_id", "reply_preview", "pinned_at"];

let extrasDisponibles = true;   // false si falta ejecutar mensajes_extras.sql
const respuestaPendiente = { admin: null, cliente: null };
let menuAbierto = null;

async function consultarMensajes(userId) {
  const base = ["id", MSG.userCol, MSG.senderCol, MSG.textoCol, MSG.archivoCol, MSG.leidoCol, MSG.fechaCol];
  for (let intento = 0; intento < 2; intento++) {
    const cols = extrasDisponibles ? [...base, ...COLS_EXTRA] : base;
    const r = await supabase
      .from(MSG.tabla)
      .select(cols.join(", "))
      .eq(MSG.userCol, userId)
      .order(MSG.fechaCol, { ascending: false })
      .limit(200);
    if (r.error && extrasDisponibles && columnaNoExiste(r.error)) {
      extrasDisponibles = false;   // los chats siguen funcionando, solo sin las opciones extra
      console.warn("Faltan columnas en messages: ejecutá mensajes_extras.sql para habilitar responder, reaccionar y fijar.");
      continue;
    }
    if (!r.error) r.data = (r.data || []).reverse();
    return r;
  }
}

// Cambia si llega un mensaje, una reacción o un fijado
const firmaDe = (filas) =>
  filas.map((f) => f.id + (f.pinned_at ? "p" : "") + (f.reactions ? JSON.stringify(f.reactions) : "")).join(",");

const previewDe = (f) => String(f[MSG.textoCol] || (f[MSG.archivoCol] ? "📎 Comprobante" : "")).slice(0, 140);

function autorDe(f, ctx) {
  const admin = esDelAdmin(f);
  return ctx === "admin" ? (admin ? "Tú" : "Cliente") : (admin ? "Soporte" : "Tú");
}

function agregarRespuesta(fila, ctx) {
  const r = respuestaPendiente[ctx];
  if (r && extrasDisponibles) {
    fila.reply_to_id = String(r.id);
    fila.reply_preview = r.preview;
  }
}

function inyectarEstilosMensajes() {
  if ($("estilos-mensajes")) return;
  const st = document.createElement("style");
  st.id = "estilos-mensajes";
  st.textContent = `
    .msg-ctx{position:relative;cursor:pointer}
    .msg-chev{position:absolute;top:2px;right:4px;width:20px;height:20px;padding:0;border:none;border-radius:50%;
      background:rgba(13,14,21,.88);color:#f3ba2f;font-size:12px;line-height:20px;cursor:pointer;opacity:0;transition:opacity .15s;z-index:1}
    .msg-ctx:hover .msg-chev,.msg-chev:focus-visible,.msg-ctx.msg-abierto .msg-chev{opacity:1}
    @media (hover:none){.msg-chev{opacity:.75}}
    .msg-ctx.msg-abierto{outline:1px solid #f3ba2f}
    .msg-pin{font-size:10px;color:#f3ba2f;margin-bottom:2px;font-weight:700}
    .msg-quote{border-left:3px solid #f3ba2f;background:rgba(0,0,0,.28);border-radius:4px;padding:3px 7px;margin-bottom:4px;
      font-size:11px;color:#cbd5e1;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .msg-quote b{display:block;color:#f3ba2f;font-size:10px}
    .msg-reacts{display:flex;flex-wrap:wrap;gap:3px;margin-top:4px}
    .msg-react{background:rgba(0,0,0,.35);border:1px solid #2b3544;border-radius:10px;padding:0 6px;font-size:11px;color:#fff;cursor:pointer}
    .msg-react.mia{border-color:#f3ba2f;background:rgba(243,186,47,.2)}
    .msg-flash{animation:msgflash 1.4s ease}
    @keyframes msgflash{0%,60%{box-shadow:0 0 0 2px #f3ba2f}100%{box-shadow:0 0 0 0 transparent}}
    #menu-mensaje{position:fixed;z-index:10001;min-width:190px;max-width:260px;background:#161822;border:1px solid #f3ba2f;border-radius:10px;
      box-shadow:0 8px 28px rgba(0,0,0,.7);padding:6px;font-size:13px;color:#fff}
    #menu-mensaje .mm-emojis{display:flex;gap:2px;padding:2px 2px 6px;margin-bottom:4px;border-bottom:1px solid #2b3544}
    #menu-mensaje .mm-emoji{background:none;border:none;font-size:20px;line-height:1;cursor:pointer;border-radius:6px;padding:3px 5px}
    #menu-mensaje .mm-item{display:flex;align-items:center;gap:8px;width:100%;text-align:left;background:none;border:none;color:#fff;
      padding:7px 9px;border-radius:6px;cursor:pointer;font-size:13px}
    #menu-mensaje .mm-item:hover,#menu-mensaje .mm-item:focus-visible,#menu-mensaje .mm-emoji:hover,#menu-mensaje .mm-emoji:focus-visible{
      background:rgba(243,186,47,.2);color:#f3ba2f;outline:none}
    #menu-mensaje .mm-nota{font-size:11px;color:#888;padding:6px 9px 2px}
    .barra-msg{display:none;align-items:center;gap:8px;background:#161822;border:1px solid #2b3544;border-left:3px solid #f3ba2f;
      border-radius:6px;padding:4px 8px;margin-bottom:6px;font-size:11px;color:#cbd5e1}
    .barra-msg .bm-texto{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .barra-msg b{color:#f3ba2f}
    .barra-msg button{background:none;border:none;color:#f3ba2f;cursor:pointer;font-size:14px;padding:0 2px}
    .barra-fijados{flex-direction:column;align-items:stretch;gap:3px}
    .barra-fijados .fijado{cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #admin-users-list,#admin-msgs,.chat-messages-area{scrollbar-width:thin;scrollbar-color:#f3ba2f #0e0f16}
    #admin-users-list::-webkit-scrollbar,#admin-msgs::-webkit-scrollbar{width:8px}
    #admin-users-list::-webkit-scrollbar-thumb,#admin-msgs::-webkit-scrollbar-thumb{background:#f3ba2f;border-radius:4px}
    #admin-users-list::-webkit-scrollbar-track,#admin-msgs::-webkit-scrollbar-track{background:#0e0f16}
  `;
  document.head.appendChild(st);
}

// Barras auxiliares (citas y fijados): se crean junto al chat correspondiente
function barraDe(ctx, tipo) {
  const id = (ctx === "admin" ? "admin-" : "chat-") + (tipo === "resp" ? "reply-bar" : "pins");
  let el = $(id);
  if (el) return el;
  const cont = ctx === "admin" ? $("admin-msgs") : $("chat-messages-container");
  if (!cont) return null;
  el = document.createElement("div");
  el.id = id;
  el.className = "barra-msg" + (tipo === "pins" ? " barra-fijados" : "");
  if (tipo === "pins") {
    cont.parentNode.insertBefore(el, cont);
  } else {
    const ref = ctx === "admin" ? $("admin-respuesta")?.parentNode : cont.parentNode.querySelector(".chat-input-area");
    if (!ref) return null;
    ref.parentNode.insertBefore(el, ref);
  }
  return el;
}

function renderBarraRespuesta(ctx) {
  const el = barraDe(ctx, "resp");
  if (!el) return;
  const r = respuestaPendiente[ctx];
  el.replaceChildren();
  if (!r) { el.style.display = "none"; return; }
  const txt = document.createElement("div");
  txt.className = "bm-texto";
  const b = document.createElement("b");
  b.textContent = "Respondiendo a " + r.autor + ": ";
  txt.append(b, document.createTextNode(r.preview));
  const x = document.createElement("button");
  x.type = "button";
  x.textContent = "✕";
  x.setAttribute("aria-label", "Cancelar respuesta");
  x.addEventListener("click", () => { respuestaPendiente[ctx] = null; renderBarraRespuesta(ctx); });
  el.append(txt, x);
  el.style.display = "flex";
}

function renderBarraFijados(ctx, filas) {
  const el = barraDe(ctx, "pins");
  if (!el) return;
  const fijados = filas.filter((f) => f.pinned_at)
    .sort((a, b) => new Date(b.pinned_at) - new Date(a.pinned_at)).slice(0, 3);
  el.replaceChildren();
  if (!fijados.length) { el.style.display = "none"; return; }
  fijados.forEach((f) => {
    const d = document.createElement("div");
    d.className = "fijado";
    d.textContent = "📌 " + (previewDe(f) || "Mensaje fijado");
    d.title = "Ir al mensaje fijado";
    d.addEventListener("click", () => irAMensaje(f.id, ctx));
    el.appendChild(d);
  });
  el.style.display = "flex";
}

function irAMensaje(id, ctx) {
  const cont = ctx === "admin" ? $("admin-msgs") : $("chat-messages-container");
  const el = cont && cont.querySelector(`[data-mid="${CSS.escape(String(id))}"]`);
  if (!el) return mostrarAviso("Ese mensaje es muy antiguo para mostrarse acá.", "info");
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("msg-flash");
  void el.offsetWidth;
  el.classList.add("msg-flash");
}

// Agrega cita, fijado, reacciones y el acceso al menú a una burbuja ya armada
function adornarMensaje(burbuja, f, ctx, filas) {
  burbuja.classList.add("msg-ctx");
  burbuja.dataset.mid = f.id;

  if (f.reply_preview) {
    const original = f.reply_to_id != null ? filas.find((x) => String(x.id) === String(f.reply_to_id)) : null;
    const q = document.createElement("div");
    q.className = "msg-quote";
    if (original) {
      const a = document.createElement("b");
      a.textContent = autorDe(original, ctx);
      q.appendChild(a);
    }
    q.appendChild(document.createTextNode(String(f.reply_preview)));
    q.addEventListener("click", (e) => { e.stopPropagation(); if (f.reply_to_id != null) irAMensaje(f.reply_to_id, ctx); });
    burbuja.prepend(q);
  }
  if (f.pinned_at) {
    const pin = document.createElement("div");
    pin.className = "msg-pin";
    pin.textContent = "📌 Fijado";
    burbuja.prepend(pin);
  }

  const reacciones = f.reactions && typeof f.reactions === "object" ? Object.entries(f.reactions) : [];
  const yo = usuarioActual ? usuarioActual.id : null;
  const activas = reacciones.filter(([, ids]) => Array.isArray(ids) && ids.length);
  if (activas.length) {
    const fila = document.createElement("div");
    fila.className = "msg-reacts";
    activas.forEach(([emoji, ids]) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "msg-react" + (ids.includes(yo) ? " mia" : "");
      chip.textContent = emoji + (ids.length > 1 ? " " + ids.length : "");
      chip.setAttribute("aria-label", `Reacción ${emoji}, ${ids.length}`);
      chip.addEventListener("click", (e) => { e.stopPropagation(); reaccionarMensaje(f, emoji, ctx); });
      fila.appendChild(chip);
    });
    const hora = burbuja.querySelector("[data-hora]");
    if (hora) burbuja.insertBefore(fila, hora); else burbuja.appendChild(fila);
  }

  const chev = document.createElement("button");
  chev.type = "button";
  chev.className = "msg-chev";
  chev.textContent = "▾";
  chev.setAttribute("aria-label", "Opciones del mensaje");
  chev.setAttribute("aria-haspopup", "menu");
  chev.addEventListener("click", (e) => { e.stopPropagation(); abrirMenuMensaje(f, ctx, burbuja); });
  burbuja.appendChild(chev);

  burbuja.addEventListener("click", (e) => {
    if (e.target.closest("img, a, .msg-react, .msg-quote, .msg-chev")) return;
    if (window.getSelection && String(window.getSelection()).trim()) return;   // el usuario está seleccionando texto
    abrirMenuMensaje(f, ctx, burbuja);
  });
}

function cerrarMenuMensaje() {
  if (!menuAbierto) return;
  menuAbierto.menu.remove();
  menuAbierto.burbuja?.classList.remove("msg-abierto");
  menuAbierto = null;
}

function abrirMenuMensaje(f, ctx, burbuja) {
  cerrarMenuMensaje();
  const menu = document.createElement("div");
  menu.id = "menu-mensaje";
  menu.setAttribute("role", "menu");
  const texto = f[MSG.textoCol] ? String(f[MSG.textoCol]) : "";

  const item = (icono, etiqueta, fn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "mm-item";
    b.setAttribute("role", "menuitem");
    b.textContent = `${icono}  ${etiqueta}`;
    b.addEventListener("click", () => { cerrarMenuMensaje(); fn(); });
    menu.appendChild(b);
  };

  if (extrasDisponibles) {
    const fila = document.createElement("div");
    fila.className = "mm-emojis";
    REACCIONES.forEach((emoji) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "mm-emoji";
      b.textContent = emoji;
      b.setAttribute("role", "menuitem");
      b.setAttribute("aria-label", "Reaccionar " + emoji);
      b.addEventListener("click", () => { cerrarMenuMensaje(); reaccionarMensaje(f, emoji, ctx); });
      fila.appendChild(b);
    });
    menu.appendChild(fila);
  }
  if (texto) item("📋", "Copiar", () => copiarTexto(texto));
  if (extrasDisponibles) {
    item("↩️", "Responder", () => responderMensaje(f, ctx));
    item("📌", f.pinned_at ? "Desfijar" : "Fijar", () => fijarMensaje(f, ctx));
  } else if (ctx === "admin") {
    const nota = document.createElement("div");
    nota.className = "mm-nota";
    nota.textContent = "Para responder, reaccionar y fijar ejecutá mensajes_extras.sql";
    menu.appendChild(nota);
  }
  if (!menu.querySelector("[role=menuitem]") && !menu.querySelector(".mm-nota")) return;

  menu.style.visibility = "hidden";
  document.body.appendChild(menu);
  const r = burbuja.getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  const left = Math.min(Math.max(8, r.right - mw), window.innerWidth - mw - 8);
  let top = r.bottom + 4;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
  menu.style.left = left + "px";
  menu.style.top = top + "px";
  menu.style.visibility = "visible";
  burbuja.classList.add("msg-abierto");
  menuAbierto = { menu, burbuja };
  menu.querySelector("[role=menuitem]")?.focus();

  menu.addEventListener("keydown", (e) => {
    const items = [...menu.querySelectorAll("[role=menuitem]")];
    const i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  });
}

async function copiarTexto(t) {
  try {
    await navigator.clipboard.writeText(t);
  } catch (_) {
    const ta = document.createElement("textarea");
    ta.value = t;
    ta.style.cssText = "position:fixed;opacity:0;";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (__) { /* sin permiso */ }
    ta.remove();
    if (!ok) return mostrarAviso("No se pudo copiar el mensaje.", "error");
  }
  mostrarAviso("Mensaje copiado", "ok");
}

function responderMensaje(f, ctx) {
  respuestaPendiente[ctx] = { id: f.id, autor: autorDe(f, ctx), preview: previewDe(f) };
  renderBarraRespuesta(ctx);
  (ctx === "admin" ? $("admin-respuesta") : $("chat-user-input"))?.focus();
}

function refrescarContexto(ctx) {
  return ctx === "admin" ? refrescarMensajes(true) : cargarHistorialCliente(true);
}

function errorExtras(err, accion) {
  console.error(`Error al ${accion}:`, err);
  mostrarAviso(
    err && err.code === "PGRST202" ? "Falta ejecutar mensajes_extras.sql en Supabase."
    : err && err.code === "42501" ? "No tenés permiso para hacer eso."
    : `No se pudo ${accion}.`,
    "error"
  );
}

async function reaccionarMensaje(f, emoji, ctx) {
  if (!usuarioActual) return;
  const { error } = await supabase.rpc(RPC_REACCIONAR, { p_message_id: String(f.id), p_emoji: emoji });
  if (error) return errorExtras(error, "reaccionar");
  await refrescarContexto(ctx);
}

async function fijarMensaje(f, ctx) {
  if (!usuarioActual) return;
  const { error } = await supabase.rpc(RPC_FIJAR, { p_message_id: String(f.id), p_fijar: !f.pinned_at });
  if (error) return errorExtras(error, f.pinned_at ? "desfijar el mensaje" : "fijar el mensaje");
  await refrescarContexto(ctx);
}

// Cierre del menú al tocar fuera, con Escape, al hacer scroll o redimensionar
document.addEventListener("click", (e) => { if (menuAbierto && !menuAbierto.menu.contains(e.target)) cerrarMenuMensaje(); }, true);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") cerrarMenuMensaje(); });
document.addEventListener("scroll", () => cerrarMenuMensaje(), true);
window.addEventListener("resize", cerrarMenuMensaje);
inyectarEstilosMensajes();

function notificarLogin(user) {
  const clave = "loginNotificado:" + user.id;
  try {
    if (sessionStorage.getItem(clave)) return;
    sessionStorage.setItem(clave, "1");
  } catch (_) { /* sessionStorage bloqueado: seguimos igual */ }
  postWebhook({ tipo_evento: "LOGIN", user_id: user.id, email: user.email, fecha: new Date().toISOString() }, 10000)
    .catch((err) => console.warn("No se pudo notificar el login:", err.message || err));
}

// El saludo inicial del chat no se borra al cargar el historial (los módulos corren con el DOM ya listo)
const saludoChat = $("chat-messages-container")?.firstElementChild;
if (saludoChat) saludoChat.dataset.fijo = "1";

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
