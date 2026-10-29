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
  WEBHOOK_URL: "https://n8n.almazarela.com/webhook/free-fire-check",   // verificación del jugador (flujo "id del jugador")
  // Avisos opcionales (login y mensajes del chat). Vacío = no se envían. NO usar la URL del canje: esa la llama solo Supabase.
  WEBHOOK_EVENTOS_URL: "",

  ADMIN_EMAIL: "almita.zarela@gmail.com",

  // Número de WhatsApp en formato internacional sin "+" ni espacios. ¡COMPLETAR!
  WHATSAPP_NUMBER: "1166201432",

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
  COL_SALDO_ARS: "saldo_ars",

  BUCKET_COMPROBANTES: "comprobantes",   // bucket PRIVADO de Storage (lo crea chat_cliente.sql)
  // Compra con saldo: true = la página espera la confirmación de n8n antes de decir "acreditados"
  ESPERAR_CONFIRMACION: true,
  ESPERA_ORDEN_MS: 45000,
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

async function postWebhook(payload, timeoutMs = CONFIG.TIMEOUT_MS, url = CONFIG.WEBHOOK_URL) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
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
const formatoARS = (n) => "$" + (Number(n) || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatoMoneda = (m, n) => (m === "ARS" ? formatoARS(n) : formatoUSD(n));
const conCodigo = (m, n) => `${m} ${formatoMoneda(m, n)}`;

// Corta cualquier espera de red que se cuelgue (nada de pantallas bloqueadas para siempre)
function conTimeout(promesa, ms) {
  let t;
  const corte = new Promise((_, rechazar) => {
    t = setTimeout(() => rechazar(Object.assign(new Error("timeout"), { name: "TimeoutError" })), ms);
  });
  return Promise.race([Promise.resolve(promesa), corte]).finally(() => clearTimeout(t));
}

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

// --- Limpieza de lo que devuelve n8n: cualquier campo puede venir vacío, nulo, con otro tipo o con basura ---
const TEXTO_BASURA = /^(null|undefined|nan|\[object object\]|n\/a|none|-+)$/i;
function limpio(v, max = 40) {
  if (v === null || v === undefined || typeof v === "object" || typeof v === "boolean") return "";
  const t = String(v).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim();
  return !t || TEXTO_BASURA.test(t) ? "" : t.slice(0, max);
}
function primerTexto(obj, claves, max) {
  for (const k of claves) { const t = limpio(obj && obj[k], max); if (t) return t; }
  return "";
}
// Solo https y sin caracteres que rompan un url("...") de CSS
function urlHttps(v) {
  const t = typeof v === "string" ? v.trim() : "";
  if (!/^https:\/\/[^\s"'()<>\\]+$/i.test(t)) return "";
  try { return new URL(t).href; } catch (_) { return ""; }
}
const ANIDADOS = ["json", "data", "player", "jugador", "result", "resultado"];
const CLAVES_NOMBRE = ["nombre", "name", "nickname", "nick", "username", "player_name", "nombre_jugador"];

// Devuelve { noEncontrado, nombre, avatar, banner, nivel, region } con todo ya limpio ("" / null si falta)
function normalizarJugador(crudo) {
  let d = Array.isArray(crudo) ? crudo[0] : crudo;
  if (typeof d === "string") { try { d = JSON.parse(d); } catch (_) { d = null; } }
  for (let i = 0; i < 3 && d && typeof d === "object" && !primerTexto(d, CLAVES_NOMBRE, 32); i++) {
    const clave = ANIDADOS.find((k) => d[k] && typeof d[k] === "object");   // n8n a veces anida: { json: {...} }
    if (!clave) break;
    d = Array.isArray(d[clave]) ? d[clave][0] : d[clave];
  }
  const vacio = { noEncontrado: false, nombre: "", avatar: "", banner: "", nivel: null, region: "" };
  if (!d || typeof d !== "object") return vacio;
  const nivel = parseInt(d.nivel ?? d.level, 10);
  return {
    noEncontrado: [d.encontrado, d.found, d.existe, d.exists, d.valid].some((v) => v === false || v === "false"),
    nombre: primerTexto(d, CLAVES_NOMBRE, 32),
    avatar: urlHttps(d.avatar || d.avatar_url || d.avatarUrl || d.icon || d.foto),
    banner: urlHttps(d.banner || d.banner_url || d.bannerUrl),
    nivel: nivel > 0 && nivel < 1000 ? nivel : null,
    region: primerTexto(d, ["region", "server", "servidor"], 12),
  };
}
// Hay "prueba" de que el jugador existe aunque n8n no haya mandado el nombre
const tieneEvidencia = (j) => !!(j.nombre || j.avatar || j.banner || j.nivel);

let pintadoSeq = 0;
function pintarJugador(info, id, validado) {
  const mi = ++pintadoSeq;
  const card = $("player-card");
  const j = validado ? info : { nombre: "", avatar: "", banner: "", nivel: null, region: "" };

  // Nombre: el real, o un nombre genérico si n8n solo confirmó que el ID existe
  const real = j.nombre ? (j.nombre.startsWith("@") ? j.nombre : "@" + j.nombre) : "@JUGADOR_FF";
  $("player-name").textContent = validado ? real : "ID " + id;

  const meta = [];
  if (validado) {
    if (j.nivel) meta.push("Nivel " + j.nivel);
    if (j.region) meta.push(j.region);
    meta.push("ID " + id);
  } else {
    meta.push("Confirmá que este ID sea el correcto antes de pagar");
  }
  $("player-meta").textContent = meta.join(" · ");

  // Mismo diseño verde en ambos casos; "Jugador verificado" solo si n8n confirmó que el jugador existe
  card.querySelector(".player-label").textContent = validado ? "Jugador verificado" : "ID listo para recargar";

  // Avatar: si falta o no carga, queda el ícono por defecto (nunca una imagen rota)
  const img = $("player-avatar-img");
  const avatar = card.querySelector(".player-avatar");
  const sinImagen = () => { img.hidden = true; img.removeAttribute("src"); avatar.classList.remove("con-img"); };
  img.onerror = sinImagen;
  if (j.avatar) {
    img.referrerPolicy = "no-referrer";
    img.onload = () => { if (mi === pintadoSeq) { img.hidden = false; avatar.classList.add("con-img"); } };
    img.src = j.avatar;
  } else {
    sinImagen();
  }

  // Banner: solo se aplica cuando la imagen realmente cargó (si no, queda el fondo verde normal)
  card.classList.remove("con-banner");
  card.style.removeProperty("--banner");
  if (j.banner) {
    const pre = new Image();
    pre.referrerPolicy = "no-referrer";
    pre.onload = () => {
      if (mi !== pintadoSeq) return;
      card.style.setProperty("--banner", `url("${j.banner}")`);
      card.classList.add("con-banner");
    };
    pre.src = j.banner;
  }
  card.hidden = false;
}

let verifSeq = 0;

async function verificarJugador() {
  const input = $("player-id");
  const btn = $("btn-verificar");
  const id = (input?.value || "").trim();
  const mi = ++verifSeq;

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
    if (mi !== verifSeq) return;
    console.warn("Verificación automática no disponible:", motivo);
    pintarJugador({}, id, false);
    jugadorVerificado = { id, nombre: null, validado: false };
    estadoVerificacion("ID cargado. Revisá que sea correcto antes de comprar.", "ok");
  };

  try {
    const res = await postWebhook({ tipo_evento: "VERIFICAR_JUGADOR", id_jugador: id, playerId: id, region: "SAC" });
    if (mi !== verifSeq) return;   // el usuario cambió el ID o volvió a tocar Verificar
    if (!res.ok) return modoManual("HTTP " + res.status);

    let crudo = null;
    try { crudo = await conTimeout(res.json(), 8000); } catch (_) { return modoManual("respuesta sin JSON"); }
    if (mi !== verifSeq) return;

    const info = normalizarJugador(crudo);
    if (info.noEncontrado) {   // n8n avisó explícitamente que el ID no existe
      estadoVerificacion("Jugador no encontrado. Revisá el ID.", "error");
      return;
    }
    if (!tieneEvidencia(info)) return modoManual("el webhook no devolvió datos del jugador");

    pintarJugador(info, id, true);
    jugadorVerificado = { id, nombre: info.nombre || null, validado: true };
    estadoVerificacion("ID verificado correctamente.", "ok");
  } catch (err) {
    modoManual(err.name === "AbortError" ? "timeout" : err.message || err);
  } finally {
    if (mi === verifSeq) btn.disabled = false;
  }
}

// Si el usuario cambia el ID, la tarjeta anterior ya no corresponde: se oculta y se descarta
function alEditarId() {
  const id = ($("player-id")?.value || "").trim();
  if (jugadorVerificado && jugadorVerificado.id === id) return;
  verifSeq++;                      // invalida cualquier verificación en curso
  pintadoSeq++;
  jugadorVerificado = null;
  const card = $("player-card");
  if (card) card.hidden = true;
  estadoVerificacion("", "");
  const btn = $("btn-verificar");
  if (btn) btn.disabled = false;
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
// ------------------------- SCROLL ESTILO WHATSAPP ----------------------
// Baja el chat hasta el último mensaje y lo sostiene unos segundos: las imágenes de
// comprobantes terminan de cargar después y cambian el alto del chat.
function irAlFinal(cont, ms = 4000) {
  if (!cont) return;
  cont.dataset.pegarHasta = String(Date.now() + ms);
  if (!cont.dataset.escuchaScroll) {
    cont.dataset.escuchaScroll = "1";
    // si la persona sube con el dedo o la rueda, dejamos de forzar el scroll
    ["wheel", "touchmove"].forEach((ev) => cont.addEventListener(ev, () => { cont.dataset.pegarHasta = "0"; }, { passive: true }));
  }
  const bajar = () => { cont.style.scrollBehavior = "auto"; cont.scrollTop = cont.scrollHeight; };
  bajar();
  requestAnimationFrame(bajar);
  setTimeout(bajar, 150);
}
function seguirAbajo(cont) {
  if (cont && Date.now() < Number(cont.dataset.pegarHasta || 0)) {
    cont.style.scrollBehavior = "auto";
    cont.scrollTop = cont.scrollHeight;
  }
}

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

  const filas = data || [];   // consultarMensajes ya los entrega del más viejo al más nuevo
  const ultima = filas[filas.length - 1];
  const firma = firmaDe(filas);
  if (!forzar && firma === firmaChat) return;
  firmaChat = firma;

  const alFinal = forzar || cont.scrollHeight - cont.scrollTop - cont.clientHeight < 60;
  cerrarMenuMensaje();
  renderBarraFijados("cliente", filas);
  renderBarraRespuesta("cliente");
  const fijos = [...cont.children].filter((el) => el.dataset.fijo);
  const nuevos = [];
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
        img.addEventListener("load", () => seguirAbajo(cont));
        img.src = u;
        img.addEventListener("click", () => abrirImagen(u));
        img.addEventListener("error", () => {
          const a = Object.assign(document.createElement("a"), { href: u, target: "_blank", rel: "noopener noreferrer", textContent: "📎 Ver archivo adjunto" });
          img.replaceWith(a);
          seguirAbajo(cont);
        });
      });
    }
    if (!texto && !f[MSG.archivoCol]) div.textContent = "(mensaje sin contenido)";
    adornarMensaje(div, f, "cliente", filas);
    nuevos.push(div);
  }
  cont.replaceChildren(...fijos, ...nuevos);
  if (alFinal) irAlFinal(cont);
}

// Aviso a n8n (notificación al admin). Es opcional: si falla, el mensaje igual quedó guardado.
async function notificarChatN8n(texto, ruta, nombreArchivo) {
  let urlFirmada = null;
  if (ruta) {
    const { data } = await supabase.storage.from(CONFIG.BUCKET_COMPROBANTES).createSignedUrl(ruta, 7 * 24 * 3600);
    urlFirmada = data ? data.signedUrl : null;
  }
  if (!CONFIG.WEBHOOK_EVENTOS_URL) return;   // sin URL de avisos configurada, no se avisa
  await postWebhook({
    tipo_evento: "CHAT_MENSAJE",
    user_id: usuarioActual.id,
    email: usuarioActual.email,
    text: texto,
    nombre_archivo: nombreArchivo || "",
    file_path: ruta || "",
    archivo_url: urlFirmada || "",
  }, 15000, CONFIG.WEBHOOK_EVENTOS_URL);
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
    irAlFinal($("chat-messages-container"));
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
  if (!user || (usuarioActual && usuarioActual.id !== user.id)) resetHistorialCompras();   // otra cuenta: no se arrastra el historial anterior
  usuarioActual = user;
  const logueado = !!user;
  const esAdminEmail = logueado && (user.email || "").toLowerCase() === CONFIG.ADMIN_EMAIL.toLowerCase();

  $("auth-forms").style.display = logueado ? "none" : "block";
  $("user-dashboard").style.display = logueado ? "block" : "none";
  $("admin-panel-section").style.display = esAdminEmail ? "block" : "none";
  if ($("sidebar-historial")) $("sidebar-historial").style.display = logueado ? "block" : "none";
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
  resetSaldos();

  if (logueado) {
    // setTimeout evita bloquear el cliente de Supabase dentro de onAuthStateChange
    setTimeout(() => cargarPerfilYSaldo(user, esAdminEmail), 0);
    setTimeout(iniciarChatCliente, 0);
    setTimeout(() => cargarHistorialCompras(true), 0);   // deja listo el contador de recargas "en proceso"
  } else {
    detenerChatCliente();
  }
}

const saldos = { USD: 0, ARS: 0 };

function renderSaldos() {
  const set = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };
  set("header-balance-amount", formatoUSD(saldos.USD));
  set("header-balance-ars", formatoARS(saldos.ARS));
  set("menu-wallet-balance", formatoUSD(saldos.USD) + " USD");
  set("menu-wallet-balance-ars", formatoARS(saldos.ARS) + " ARS");
  set("user-balance", formatoUSD(saldos.USD) + " USD");
  set("user-balance-ars", formatoARS(saldos.ARS) + " ARS");
}
function pintarSaldo(n, moneda = "USD") {
  saldos[moneda === "ARS" ? "ARS" : "USD"] = Number(n) || 0;
  renderSaldos();
}
function resetSaldos() { saldos.USD = 0; saldos.ARS = 0; renderSaldos(); }

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

let saldoArsDisponible = true;   // false si falta la columna saldo_ars: ejecutá doble_saldo.sql

async function cargarSaldo(user) {
  if (!perfilesDisponible || !saldoDisponible) return resetSaldos();
  const consulta = (cols) => supabase.from(CONFIG.TABLA_PERFILES).select(cols).eq(CONFIG.COL_ID, user.id).maybeSingle();
  try {
    let r = await consulta(saldoArsDisponible ? `${CONFIG.COL_SALDO}, ${CONFIG.COL_SALDO_ARS}` : CONFIG.COL_SALDO);
    if (r.error && columnaNoExiste(r.error) && saldoArsDisponible) {
      saldoArsDisponible = false;
      console.warn(`Falta la columna ${CONFIG.COL_SALDO_ARS}: ejecutá doble_saldo.sql para habilitar el saldo en pesos.`);
      r = await consulta(CONFIG.COL_SALDO);
    }
    if (r.error) throw r.error;
    const d = r.data || {};
    saldos.USD = Number(d[CONFIG.COL_SALDO]) || 0;
    saldos.ARS = Number(d[CONFIG.COL_SALDO_ARS]) || 0;
    renderSaldos();
  } catch (err) {
    if (columnaNoExiste(err)) {
      saldoDisponible = false;
      console.warn(`Falta la columna ${CONFIG.COL_SALDO} en ${CONFIG.TABLA_PERFILES}: ejecutá profiles.sql.`);
    } else if (tablaNoExiste(err)) {
      perfilesDisponible = false;
    } else {
      console.warn("No se pudo leer el saldo:", err.message || err);
    }
    resetSaldos();
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
    const saldoTxt = saldoDisponible
      ? " · " + formatoUSD(fila[CONFIG.COL_SALDO]) + (saldoArsDisponible ? " · ARS " + formatoARS(fila[CONFIG.COL_SALDO_ARS]) : "")
      : "";

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
    for (let intento = 0; intento < 3; intento++) {
      const cols = saldoDisponible ? [...base, CONFIG.COL_SALDO, ...(saldoArsDisponible ? [CONFIG.COL_SALDO_ARS] : [])] : base;
      ({ data, error } = await supabase
        .from(CONFIG.TABLA_PERFILES)
        .select(cols.join(", "))
        .order(CONFIG.COL_EMAIL, { ascending: true })
        .limit(200));
      if (error && columnaNoExiste(error)) {      // reintenta sin la columna que falta
        if (saldoArsDisponible) { saldoArsDisponible = false; continue; }
        if (saldoDisponible) { saldoDisponible = false; continue; }
      }
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
    programarOrdenes();
    if (vistaAdmin === "ordenes") renderOrdenesAdmin();   // los nombres de clientes ya están disponibles

    if (!pollLista) {
      pollLista = setInterval(() => { if (!document.hidden) cargarPanelAdmin(true); }, 10000);
    }
  } finally {
    cargandoLista = false;
  }
}

// ------------------------- MI HISTORIAL DE COMPRAS (cliente) ------------
// Lee ordenes_recarga del usuario logueado (RLS: cada uno ve solo las suyas).
// El código del PIN NUNCA se muestra ni se descarga: solo si quedó asignado.
const ESTADOS_COMPRA = {
  completada:  { texto: "Acreditada",  color: "#2ecc71", nota: "" },
  pendiente:   { texto: "En proceso",  color: "#f3ba2f", nota: "Tu recarga se está acreditando. Si tarda mucho, escribinos por el chat." },
  error_envio: { texto: "En proceso",  color: "#f3ba2f", nota: "Tu recarga está en revisión y se acredita manualmente. Si tarda mucho, escribinos por el chat." },
  fallida:     { texto: "Devuelta",    color: "#ff8a65", nota: "No se pudo acreditar y tu saldo fue devuelto." },
};
const PASO_HISTORIAL = 30;
let comprasUsuario = [];
let comprasLimite = PASO_HISTORIAL;
let comprasHayMas = false;
let comprasColsMoneda = true;
let comprasCargando = false;
let comprasError = "";
let comprasSeq = 0;
let comprasRepetir = false;
let pollCompras = null;
const comprasAbierto = () => !!$("hist-panel") && !$("hist-panel").hidden;
const enProceso = (o) => o.estado === "pendiente" || o.estado === "error_envio";
const fechaHora = (v) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
};

function actualizarContadorCompras() {
  const n = comprasUsuario.filter(enProceso).length;
  const c = $("hist-contador");
  if (!c) return;
  c.hidden = n === 0;
  c.textContent = String(n);
  c.title = n === 1 ? "1 recarga en proceso" : n + " recargas en proceso";
}

async function cargarHistorialCompras(silencioso = false) {
  const lista = $("hist-lista");
  if (!lista || !usuarioActual) return;
  if (comprasCargando) { comprasRepetir = true; return; }   // ya hay una consulta: se repite apenas termine (datos al día)
  comprasCargando = true;
  const mi = ++comprasSeq;
  const uid = usuarioActual.id;
  const btn = $("hist-refrescar"), mas = $("hist-mas");
  if (btn) btn.disabled = true;
  if (mas) mas.disabled = true;
  try {
    if (!silencioso && !comprasUsuario.length) mensajeLista(lista, "Cargando tus compras…", "#8b93a7");
    let data = null, error = null;
    for (let intento = 0; intento < 2; intento++) {
      const cols = ["id", "paquete_id", "id_jugador", "diamantes", "precio_usd", "pin_id", "estado", "created_at", ...(comprasColsMoneda ? ["moneda", "precio_cobrado"] : [])];
      ({ data, error } = await conTimeout(
        supabase.from("ordenes_recarga").select(cols.join(", ")).eq("user_id", uid)
          .order("created_at", { ascending: false }).limit(comprasLimite + 1), 15000));
      if (error && comprasColsMoneda && columnaNoExiste(error)) { comprasColsMoneda = false; continue; }
      break;
    }
    if (mi !== comprasSeq || !usuarioActual || usuarioActual.id !== uid) return;   // cerró sesión o cambió de cuenta
    if (error) {
      console.warn("No se pudo cargar el historial de compras:", error.message || error);
      comprasError = tablaNoExiste(error) ? "El historial todavía no está disponible." : "No pudimos cargar tus compras. Probá de nuevo en un momento.";
    } else {
      comprasError = "";
      const filas = Array.isArray(data) ? data : [];
      comprasHayMas = filas.length > comprasLimite;
      comprasUsuario = filas.slice(0, comprasLimite);
    }
  } catch (err) {
    if (mi !== comprasSeq) return;
    console.warn("Historial de compras sin respuesta:", err.message || err);
    comprasError = "La consulta tardó demasiado. Probá de nuevo con “Actualizar”.";
  } finally {
    comprasCargando = false;
    if (btn) btn.disabled = false;
    if (mas) mas.disabled = false;
  }
  actualizarContadorCompras();
  renderHistorialCompras();
  if (comprasRepetir) { comprasRepetir = false; cargarHistorialCompras(true); }
}

function filtrarCompras() {
  const f = $("hist-filtro")?.value || "todas";
  return comprasUsuario.filter((o) => f === "todas" || (f === "proceso" ? enProceso(o) : o.estado === f));
}

function filaCompra(k, v, clase) {
  const f = document.createElement("div");
  f.className = "hist-fila";
  const a = document.createElement("span"); a.textContent = k;
  const b = document.createElement("b"); b.textContent = v;
  if (clase) b.className = clase;
  f.append(a, b);
  return f;
}

function renderHistorialCompras() {
  const lista = $("hist-lista"), resumen = $("hist-resumen"), mas = $("hist-mas");
  if (!lista) return;
  if (mas) mas.hidden = !comprasHayMas;

  if (comprasError && !comprasUsuario.length) {
    if (resumen) resumen.textContent = "";
    return mensajeLista(lista, comprasError, "#ff8a8a");
  }
  const filas = filtrarCompras();
  if (resumen) {
    resumen.textContent = comprasUsuario.length
      ? `${filas.length} de ${comprasUsuario.length} compras` + (comprasHayMas ? " (hay más antiguas)" : "") + (comprasError ? " · " + comprasError : "")
      : "";
  }
  lista.replaceChildren();
  if (!comprasUsuario.length) return mensajeLista(lista, "Todavía no hiciste compras. Tus recargas van a aparecer acá.", "#8b93a7");
  if (!filas.length) return mensajeLista(lista, "No hay compras con ese filtro.", "#8b93a7");

  filas.forEach((o) => {
    const est = ESTADOS_COMPRA[o.estado] || { texto: String(o.estado || "?"), color: "#8b93a7", nota: "" };
    const item = document.createElement("div");
    item.className = "hist-item";
    item.style.setProperty("--est", est.color);

    const top = document.createElement("div");
    top.className = "hist-top";
    const paquete = document.createElement("div");
    paquete.className = "hist-paquete";
    paquete.textContent = o.diamantes ? o.diamantes + " 💎 Diamantes" : String(o.paquete_id || "Paquete");
    const badge = document.createElement("span");
    badge.className = "hist-estado";
    badge.textContent = est.texto;
    top.append(paquete, badge);
    item.appendChild(top);

    const moneda = o.moneda === "ARS" ? "ARS" : "USD";
    const valor = o.precio_cobrado != null && o.precio_cobrado !== "" ? o.precio_cobrado : o.precio_usd;
    item.append(
      filaCompra("Fecha y hora", fechaHora(o.created_at)),
      filaCompra("ID de Free Fire", String(o.id_jugador || "-")),
      filaCompra("Moneda", moneda === "ARS" ? "ARS (pesos)" : "USD (dólares)"),
      filaCompra(o.estado === "fallida" ? "Monto (devuelto)" : "Monto descontado", conCodigo(moneda, valor), "monto" + (o.estado === "fallida" ? " devuelto" : "")),
    );
    // Una sola fila para Orden y PIN (más compacto). Se indica si el PIN quedó asignado, nunca su código.
    item.appendChild(o.estado === "fallida"
      ? filaCompra("Orden", "#" + o.id)
      : filaCompra("Orden · PIN", `#${o.id} · ${o.pin_id ? "PIN asignado ✔" : "PIN sin asignar"}`));
    if (est.nota) {
      const n = document.createElement("div");
      n.className = "hist-nota";
      n.textContent = est.nota;
      item.appendChild(n);
    }
    lista.appendChild(item);
  });
}

// Abre/cierra el panel; al abrir consulta y, mientras está abierto, se actualiza solo si hay recargas en proceso
function alternarHistorial(forzar) {
  const panel = $("hist-panel"), toggle = $("hist-toggle");
  if (!panel || !toggle) return;
  const abrir = typeof forzar === "boolean" ? forzar : panel.hidden;
  panel.hidden = !abrir;
  toggle.setAttribute("aria-expanded", String(abrir));
  clearInterval(pollCompras); pollCompras = null;
  if (!abrir) return;
  cargarHistorialCompras(false);
  pollCompras = setInterval(() => {
    if (!document.hidden && usuarioActual && comprasUsuario.some(enProceso)) cargarHistorialCompras(true);
  }, 15000);
}

// Desde el menú lateral: cierra el menú, lleva al perfil y abre el historial
function abrirHistorial() {
  if (!usuarioActual) {
    mostrarAviso("Iniciá sesión con Google para ver tu historial.", "error");
    return;
  }
  if ($("sidebar-menu")?.classList.contains("open")) toggleMenu();
  alternarHistorial(true);
  setTimeout(() => $("user-dashboard")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
}

function resetHistorialCompras() {
  comprasSeq++;
  clearInterval(pollCompras); pollCompras = null;
  comprasUsuario = []; comprasLimite = PASO_HISTORIAL; comprasHayMas = false; comprasError = ""; comprasCargando = false;
  const panel = $("hist-panel");
  if (panel && !panel.hidden) { panel.hidden = true; $("hist-toggle")?.setAttribute("aria-expanded", "false"); }
  if ($("hist-lista")) $("hist-lista").replaceChildren();
  if ($("hist-resumen")) $("hist-resumen").textContent = "";
  actualizarContadorCompras();
}

function iniciarHistorialCompras() {
  $("hist-filtro")?.addEventListener("change", renderHistorialCompras);
  $("hist-refrescar")?.addEventListener("click", () => cargarHistorialCompras(false));
  $("hist-mas")?.addEventListener("click", () => { comprasLimite += PASO_HISTORIAL; cargarHistorialCompras(true); });
}

// ------------------------- PANEL ADMIN: HISTORIAL DE ÓRDENES ------------
// Lee ordenes_recarga (el admin ve todas por RLS) y permite reenviar a n8n las que quedaron
// en 'error_envio' o 'pendiente' con la función SQL admin_reenviar_orden (pines_y_compras.sql).
const RPC_REENVIAR = "admin_reenviar_orden";
const ESTADOS_ORDEN = {
  pendiente:   { texto: "Pendiente",          color: "#f3ba2f" },
  error_envio: { texto: "Error de envío",     color: "#ff5c5c" },
  completada:  { texto: "Completada",         color: "#2ecc71" },
  fallida:     { texto: "Fallida (devuelta)", color: "#ff8a65" },
};
const REENVIABLES = new Set(["pendiente", "error_envio"]);

let ordenesAdmin = [];
let ordenesError = "";              // mensaje si no se pudo cargar
let ordenesColsMoneda = true;       // false si falta ejecutar doble_saldo.sql (columnas moneda / precio_cobrado)
let ordenesColsEnvio = true;        // false si falta ejecutar n8n_envio_fix.sql (n8n_http_status / enviado_at)
let revisarEnviosDisponible = true; // false si falta la función admin_revisar_envios (n8n_envio_fix.sql)
let cargandoOrdenes = false;
let ultimaCargaOrdenes = 0;
let vistaAdmin = "clientes";
let filtroOrdenesInicial = true;    // la primera vez muestra "Requieren atención" solo si hay alguna
const reenviando = new Set();

const atencion = (o) => REENVIABLES.has(o.estado);
const fechaCorta = (v) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

function mostrarVistaAdmin(vista) {
  vistaAdmin = vista === "ordenes" || vista === "stock" ? vista : "clientes";
  [["clientes", "admin-vista-clientes", "admin-tab-clientes"], ["ordenes", "admin-vista-ordenes", "admin-tab-ordenes"], ["stock", "admin-vista-stock", "admin-tab-stock"]].forEach(([v, vid, tid]) => {
    const vistaEl = $(vid), t = $(tid);
    if (vistaEl) vistaEl.hidden = v !== vistaAdmin;
    if (t) {
      t.classList.toggle("activa", v === vistaAdmin);
      t.setAttribute("aria-selected", String(v === vistaAdmin));
    }
  });
  if (vistaAdmin === "ordenes") cargarOrdenesAdmin(false);
  if (vistaAdmin === "stock") cargarStockPines();
}

// ------------------------- STOCK DE PINs (solo admin) ------------------
const ETIQUETA_STOCK = { "ff-110": "100", "ff-341": "300", "ff-572": "500", "ff-1166": "1000", "ff-2398": "2000", "ff-6160": "5000" };
const PIN_VALIDO = /^[A-Za-z0-9-]{8,64}$/;
let stockPaquetes = [];
let cargandoStock = false;
let guardandoStock = false;

function pinesDetectados(texto) {
  const lista = [...new Set(String(texto || "").split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))];
  const validos = lista.filter((p) => PIN_VALIDO.test(p));
  return { total: lista.length, validos: validos.length, invalidos: lista.length - validos.length };
}

function actualizarContadorStock() {
  const c = $("stock-contador"), btn = $("stock-agregar");
  if (!c) return;
  const r = pinesDetectados($("stock-texto") && $("stock-texto").value);
  c.textContent = r.total === 0 ? "0 PIN detectados" : `${r.validos} PIN válido${r.validos === 1 ? "" : "s"}` + (r.invalidos ? ` · ${r.invalidos} con formato raro` : "");
  if (btn) btn.disabled = guardandoStock || r.validos === 0;
}

function elegirPaqueteStock(id) {
  const sel = $("stock-paquete");
  if (sel) sel.value = id;
  document.querySelectorAll("#stock-tarjetas .stock-card").forEach((b) => b.classList.toggle("elegida", b.dataset.id === id));
}

function pintarStock() {
  const cont = $("stock-tarjetas"), sel = $("stock-paquete");
  if (!cont || !sel) return;
  const actual = sel.value;
  cont.replaceChildren();
  sel.replaceChildren();
  const soloReales = stockPaquetes.filter((p) => ETIQUETA_STOCK[p.paquete_id]);
  (soloReales.length ? soloReales : stockPaquetes).forEach((p) => {
    const etiqueta = ETIQUETA_STOCK[p.paquete_id] || String(p.diamantes);
    const libres = Number(p.disponibles) || 0;
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.id = p.paquete_id;
    b.className = "stock-card " + (libres === 0 ? "vacio" : libres < 5 ? "bajo" : "ok");
    b.setAttribute("aria-label", `Paquete de ${etiqueta}: ${libres} PIN disponibles`);
    const n1 = document.createElement("div"); n1.className = "stock-nombre"; n1.textContent = etiqueta + " 💎";
    const n2 = document.createElement("div"); n2.className = "stock-extra"; n2.textContent = p.diamantes + " diamantes";
    const n3 = document.createElement("div"); n3.className = "stock-num"; n3.textContent = String(libres);
    const n4 = document.createElement("div"); n4.className = "stock-lbl"; n4.textContent = libres === 1 ? "PIN libre" : "PIN libres";
    const n5 = document.createElement("div"); n5.className = "stock-extra"; n5.textContent = (Number(p.usados) || 0) + " usados";
    b.append(n1, n2, n3, n4, n5);
    b.addEventListener("click", () => elegirPaqueteStock(p.paquete_id));
    cont.appendChild(b);
    const o = document.createElement("option");
    o.value = p.paquete_id;
    o.textContent = `Pines de ${etiqueta} (${p.diamantes} 💎) · ${libres} libres`;
    sel.appendChild(o);
  });
  if (Array.from(sel.options).some((o) => o.value === actual)) sel.value = actual;
  elegirPaqueteStock(sel.value);
}

function mensajeErrorStock(error) {
  const m = String((error && (error.message || error.details)) || error || "");
  if (m.includes("PAQUETE_INVALIDO")) return "Ese paquete no existe o está desactivado.";
  if (m.includes("SIN_PINES")) return "No hay ningún PIN para agregar.";
  if (m.includes("DEMASIADOS_PINES")) return "Pegaste más de 500 PIN juntos. Cargalos en tandas más chicas.";
  if (m.includes("No autorizado") || m.includes("42501")) return "Tu usuario no es administrador.";
  if (/function .*admin_(stock_pines|agregar_pines)|PGRST202|42883/i.test(m)) return "Falta ejecutar stock_pines_admin.sql en Supabase (SQL Editor).";
  return "No se pudo completar: " + (m || "error desconocido");
}

async function cargarStockPines() {
  if (cargandoStock || !usuarioActual) return;
  cargandoStock = true;
  const res = $("stock-resultado");
  try {
    const { data, error } = await conTimeout(supabase.rpc("admin_stock_pines"), 12000);
    if (error) throw error;
    stockPaquetes = Array.isArray(data) ? data : [];
    pintarStock();
    actualizarContadorStock();
  } catch (e) {
    console.error("Stock de PINs:", e);
    if (res) { res.className = "stock-resultado error"; res.textContent = mensajeErrorStock(e); }
  } finally {
    cargandoStock = false;
  }
}

async function agregarPinesStock() {
  if (guardandoStock) return;
  const sel = $("stock-paquete"), area = $("stock-texto"), res = $("stock-resultado"), btn = $("stock-agregar");
  if (!sel || !area || !res || !sel.value) return;
  const r = pinesDetectados(area.value);
  if (r.validos === 0) { res.className = "stock-resultado error"; res.textContent = "Pegá al menos un PIN con formato válido."; return; }
  const p = stockPaquetes.find((x) => x.paquete_id === sel.value);
  const etiqueta = ETIQUETA_STOCK[sel.value] || sel.value;
  if (!window.confirm(`¿Agregar ${r.validos} PIN al paquete de ${etiqueta}${p ? " (" + p.diamantes + " 💎)" : ""}?`)) return;
  guardandoStock = true;
  if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }
  res.className = "stock-resultado"; res.textContent = "";
  try {
    const { data, error } = await conTimeout(supabase.rpc("admin_agregar_pines", { p_paquete_id: sel.value, p_pines: area.value }), 20000);
    if (error) throw error;
    const partes = [`✔ ${data.agregados} agregado${data.agregados === 1 ? "" : "s"} al paquete de ${etiqueta}`];
    if (data.repetidos) partes.push(`${data.repetidos} ya estaba${data.repetidos === 1 ? "" : "n"} cargado${data.repetidos === 1 ? "" : "s"}`);
    if (data.invalidos) partes.push(`${data.invalidos} con formato inválido (${(data.ejemplos_invalidos || []).join(", ")})`);
    res.className = "stock-resultado " + (data.agregados > 0 ? "ok" : "error");
    res.textContent = partes.join(" · ");
    if (data.agregados > 0 && !data.invalidos) area.value = "";
    await cargarStockPines();
  } catch (e) {
    console.error("Agregar PIN:", e);
    res.className = "stock-resultado error";
    res.textContent = mensajeErrorStock(e);
  } finally {
    guardandoStock = false;
    if (btn) btn.textContent = "Agregar al stock";
    actualizarContadorStock();
  }
}

document.addEventListener("input", (ev) => { if (ev.target && ev.target.id === "stock-texto") actualizarContadorStock(); });

function actualizarAlertaOrdenes() {
  const n = ordenesAdmin.filter((o) => o.estado === "error_envio").length;
  const b = $("admin-ordenes-alerta");
  if (!b) return;
  b.hidden = n === 0;
  b.textContent = n > 99 ? "99+" : String(n);
  b.title = n === 1 ? "1 orden con error de envío" : n + " órdenes con error de envío";
}

async function cargarOrdenesAdmin(silencioso = false) {
  const lista = $("admin-ordenes-lista");
  if (!lista || cargandoOrdenes || !usuarioActual) return;
  cargandoOrdenes = true;
  try {
    if (!silencioso && !ordenesAdmin.length) mensajeLista(lista, "Cargando historial…", "#666");
    // Antes de listar, la base mira qué respondió n8n a los envíos recientes (los que fallaron pasan a "error de envío")
    if (revisarEnviosDisponible) {
      try {
        const { error: eRev } = await conTimeout(supabase.rpc("admin_revisar_envios"), 8000);
        if (eRev && eRev.code === "PGRST202") revisarEnviosDisponible = false;
      } catch (_) { /* si no responde, se lista igual */ }
    }
    let data = null, error = null;
    for (let intento = 0; intento < 3; intento++) {
      const cols = ["id", "user_id", "paquete_id", "id_jugador", "diamantes", "precio_usd", "estado", "detalle", "envio_error", "created_at", "updated_at",
        ...(ordenesColsMoneda ? ["moneda", "precio_cobrado"] : []),
        ...(ordenesColsEnvio ? ["n8n_http_status", "enviado_at"] : [])];
      ({ data, error } = await conTimeout(
        supabase.from("ordenes_recarga").select(cols.join(", ")).order("created_at", { ascending: false }).limit(150), 15000));
      if (error && columnaNoExiste(error)) {
        if (ordenesColsEnvio && /n8n_http_status|enviado_at/.test(String(error.message || ""))) { ordenesColsEnvio = false; continue; }
        if (ordenesColsMoneda) { ordenesColsMoneda = false; continue; }
      }
      break;
    }
    if (error) {
      console.warn("No se pudo cargar el historial de órdenes:", error.message || error);
      ordenesError = tablaNoExiste(error)
        ? "Falta la tabla de órdenes: ejecutá pines_y_compras.sql en Supabase."
        : "No se pudo cargar el historial (revisá las políticas RLS de ordenes_recarga).";
    } else {
      ordenesError = "";
      ordenesAdmin = Array.isArray(data) ? data : [];
    }
  } catch (err) {
    console.warn("Historial de órdenes sin respuesta:", err.message || err);
    ordenesError = "El historial tardó demasiado en responder. Probá de nuevo con “Actualizar”.";
  } finally {
    cargandoOrdenes = false;
    ultimaCargaOrdenes = Date.now();
  }
  actualizarAlertaOrdenes();
  renderOrdenesAdmin();
}

// Recarga liviana desde el sondeo del panel: cada 10 s si el historial está a la vista, si no cada 30 s (para la alerta)
function programarOrdenes() {
  const espera = vistaAdmin === "ordenes" ? 9000 : 29000;
  if (Date.now() - ultimaCargaOrdenes >= espera) cargarOrdenesAdmin(true);
}

function etiquetaCliente(userId) {
  const f = clientesAdmin.find((c) => c[CONFIG.COL_ID] === userId);
  return f ? (f[CONFIG.COL_NOMBRE] || f[CONFIG.COL_EMAIL] || String(userId).slice(0, 8)) : String(userId || "").slice(0, 8);
}
function emailCliente(userId) {
  const f = clientesAdmin.find((c) => c[CONFIG.COL_ID] === userId);
  return (f && f[CONFIG.COL_EMAIL]) || "";
}

function montoOrden(o) {
  const m = o.moneda === "ARS" ? "ARS" : "USD";
  const valor = o.precio_cobrado != null && o.precio_cobrado !== "" ? o.precio_cobrado : o.precio_usd;
  return conCodigo(m, valor);
}

function filtrarOrdenes() {
  const filtro = $("ord-filtro")?.value || "todas";
  const q = ($("ord-buscar")?.value || "").trim().toLowerCase();
  return ordenesAdmin.filter((o) => {
    if (filtro === "atencion" ? !atencion(o) : filtro !== "todas" && o.estado !== filtro) return false;
    if (!q) return true;
    const texto = [o.id, o.id_jugador, o.paquete_id, etiquetaCliente(o.user_id), emailCliente(o.user_id)].join(" ").toLowerCase();
    return texto.includes(q);
  });
}

function crearFilaOrden(k, v) {
  const f = document.createElement("div");
  f.className = "ord-fila";
  const a = document.createElement("span"); a.textContent = k;
  const b = document.createElement("b"); b.textContent = v;
  f.append(a, b);
  return f;
}

function renderOrdenesAdmin() {
  const lista = $("admin-ordenes-lista");
  const resumen = $("ord-resumen");
  if (!lista) return;

  if (ordenesError && !ordenesAdmin.length) {
    if (resumen) resumen.textContent = "";
    return mensajeLista(lista, ordenesError, "#ff5c5c");
  }
  // Primera vez: si hay órdenes con problemas se muestran primero; si no, todas
  if (filtroOrdenesInicial && ordenesAdmin.length) {
    filtroOrdenesInicial = false;
    if ($("ord-filtro")) $("ord-filtro").value = ordenesAdmin.some(atencion) ? "atencion" : "todas";
  }
  const filas = filtrarOrdenes();
  const nAtencion = ordenesAdmin.filter(atencion).length;
  if (resumen) {
    resumen.textContent = `Mostrando ${filas.length} de ${ordenesAdmin.length} órdenes · ${nAtencion} requieren atención` + (ordenesError ? " · " + ordenesError : "");
  }
  const scroll = lista.scrollTop;
  lista.replaceChildren();
  if (!filas.length) {
    return mensajeLista(lista, ordenesAdmin.length ? "No hay órdenes con ese filtro." : "Todavía no hay órdenes de recarga.", "#888");
  }

  filas.forEach((o) => {
    const est = ESTADOS_ORDEN[o.estado] || { texto: String(o.estado || "?"), color: "#8b93a7" };
    const card = document.createElement("div");
    card.className = "ord-card";
    card.style.setProperty("--est", est.color);

    const top = document.createElement("div");
    top.className = "ord-top";
    const titulo = document.createElement("div");
    titulo.className = "ord-titulo";
    titulo.textContent = `#${o.id} · ${o.diamantes ? o.diamantes + " 💎" : o.paquete_id}`;
    const badge = document.createElement("span");
    badge.className = "ord-estado";
    badge.textContent = est.texto;
    top.append(titulo, badge);
    card.appendChild(top);

    card.append(
      crearFilaOrden("Cliente", etiquetaCliente(o.user_id) || "-"),
      crearFilaOrden("ID Free Fire", String(o.id_jugador || "-")),
      crearFilaOrden("Monto", montoOrden(o)),
      crearFilaOrden("Fecha", fechaCorta(o.created_at)),
    );
    if (o.n8n_http_status) {
      const okHttp = o.n8n_http_status >= 200 && o.n8n_http_status < 300;
      card.appendChild(crearFilaOrden("Envío a n8n", okHttp ? `Recibida (HTTP ${o.n8n_http_status})` : `Rechazada (HTTP ${o.n8n_http_status})`));
    }
    const motivo = o.envio_error || (o.estado === "fallida" ? o.detalle : "");
    if (motivo) {
      const e = document.createElement("div");
      e.className = "ord-error";
      e.textContent = (o.envio_error ? "Error: " : "Motivo: ") + motivo;
      card.appendChild(e);
    }

    const acciones = document.createElement("div");
    acciones.className = "ord-acciones";
    if (REENVIABLES.has(o.estado)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ord-btn";
      b.dataset.accion = "reenviar";
      b.dataset.orden = String(o.id);
      const ocupada = reenviando.has(o.id);
      b.disabled = ocupada;
      b.textContent = ocupada ? "Reenviando…" : "🔁 Reenviar a n8n";
      b.addEventListener("click", () => reenviarOrden(o, b));
      acciones.appendChild(b);
    }
    if (o.user_id && clientesAdmin.some((c) => c[CONFIG.COL_ID] === o.user_id)) {
      const v = document.createElement("button");
      v.type = "button";
      v.className = "ord-btn sec";
      v.textContent = "Ver cliente";
      v.addEventListener("click", () => {
        const fila = clientesAdmin.find((c) => c[CONFIG.COL_ID] === o.user_id);
        mostrarVistaAdmin("clientes");
        seleccionarCliente(fila, fila[CONFIG.COL_NOMBRE] || fila[CONFIG.COL_EMAIL] || String(o.user_id).slice(0, 8));
        $("admin-vista-clientes").scrollIntoView({ behavior: "smooth", block: "start" });
      });
      acciones.appendChild(v);
    }
    if (acciones.childElementCount) card.appendChild(acciones);
    lista.appendChild(card);
  });
  lista.scrollTop = scroll;
}

function textoErrorReenvio(err) {
  const msg = String((err && err.message) || "");
  if (err && err.name === "TimeoutError") return "Tardó demasiado en responder. Actualizá la lista para ver cómo quedó la orden antes de reintentar.";
  if (err && err.code === "PGRST202") return "Falta la función admin_reenviar_orden: ejecutá pines_y_compras.sql en Supabase.";
  if (msg.includes("No autorizado") || (err && err.code === "42501")) return "Tu usuario no tiene permiso de administrador en la base de datos.";
  if (msg.includes("ORDEN_NO_ENCONTRADA")) return "La orden ya no existe.";
  if (msg.includes("cerrada")) return "Esa orden ya estaba cerrada: actualizá la lista.";
  return "No se pudo reenviar la orden. Probá de nuevo en un momento.";
}

async function reenviarOrden(o, boton) {
  if (reenviando.has(o.id)) return;
  const pendiente = o.estado === "pendiente";
  const ok = await mostrarConfirmacion({
    tono: "warn", icono: "🔁", titulo: `Reenviar orden #${o.id}`,
    texto: pendiente
      ? "Esta orden figura como pendiente. Si n8n todavía la está procesando, reenviarla podría acreditar los diamantes dos veces."
      : "Se vuelve a enviar la recarga a n8n con el PIN que ya está reservado. No se cobra de nuevo.",
    filas: [
      ["Cliente", etiquetaCliente(o.user_id) || "-"],
      ["ID Free Fire", String(o.id_jugador || "-")],
      ["Paquete", o.diamantes ? o.diamantes + " 💎" : String(o.paquete_id)],
      ["Monto", montoOrden(o)],
    ],
    confirmar: "Reenviar ahora",
  });
  if (!ok) return;

  reenviando.add(o.id);
  if (boton) { boton.disabled = true; boton.textContent = "Reenviando…"; }
  const cerrar = [{ texto: "Cerrar", primario: true }];
  try {
    const { data, error } = await conTimeout(supabase.rpc(RPC_REENVIAR, { p_orden_id: o.id }), 25000);
    if (error) throw error;
    const nuevo = typeof data === "string" ? data : (data && data.estado) || "";

    // El envío es asíncrono: "pendiente" solo significa que quedó en cola. La respuesta real de n8n se consulta aparte.
    let verif = null;
    if (nuevo === "pendiente" && revisarEnviosDisponible) {
      if (boton) boton.textContent = "Verificando con n8n…";
      verif = await verificarEnvioN8n(o.id);
    }
    reenviando.delete(o.id);
    ultimaCargaOrdenes = 0;
    await cargarOrdenesAdmin(true);

    const actual = ordenesAdmin.find((x) => x.id === o.id);
    const motivoError = (verif && verif.envio_error) || (actual && actual.envio_error) || "";
    if (nuevo === "error_envio" || (verif && verif.estado === "error_envio")) {
      mostrarDialogo({
        tono: "error", icono: "⚠️", titulo: `La orden #${o.id} no llegó a n8n`,
        texto: motivoError || "n8n no aceptó el envío. Revisá el flujo y probá de nuevo.",
        nota: "Corregí el problema y volvé a tocar «Reenviar». El saldo y el PIN de la orden siguen reservados.",
        botones: cerrar,
      });
    } else if (verif && verif.n8n_http_status) {
      mostrarAviso(`n8n recibió la orden #${o.id} (HTTP ${verif.n8n_http_status}). La acreditación se confirma cuando n8n avise el resultado.`, "ok");
    } else if (verif && verif.sinRespuesta) {
      mostrarAviso(`Orden #${o.id} enviada, pero n8n todavía no respondió. Tocá «Actualizar» en unos segundos.`, "info");
    } else {
      mostrarAviso(`Orden #${o.id} puesta en cola para n8n.` + (revisarEnviosDisponible ? "" : " Ejecutá n8n_envio_fix.sql para confirmar la respuesta de n8n."), "info");
    }
  } catch (err) {
    console.warn("No se pudo reenviar la orden:", err.message || err);
    reenviando.delete(o.id);
    mostrarAviso(textoErrorReenvio(err), "error");
    renderOrdenesAdmin();
  } finally {
    reenviando.delete(o.id);
  }
}

// Espera (hasta ~10 s) la respuesta HTTP de n8n a un envío. Devuelve el estado de la orden, { sinRespuesta } o null si la función no existe.
async function verificarEnvioN8n(ordenId) {
  for (let i = 0; i < 5; i++) {
    await dormir(i === 0 ? 1500 : 2000);
    let r;
    try { r = await conTimeout(supabase.rpc("admin_revisar_envios", { p_orden_id: ordenId }), 8000); }
    catch (_) { continue; }
    if (r.error) {
      if (r.error.code === "PGRST202") { revisarEnviosDisponible = false; return null; }
      continue;
    }
    const d = r.data || {};
    if (d.estado !== "pendiente" || d.n8n_http_status) return d;
  }
  return { sinRespuesta: true };
}

function iniciarHistorialAdmin() {
  $("ord-filtro")?.addEventListener("change", renderOrdenesAdmin);
  $("ord-buscar")?.addEventListener("input", renderOrdenesAdmin);
  $("ord-refrescar")?.addEventListener("click", () => cargarOrdenesAdmin(false));
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
  ordenesAdmin = []; ordenesError = ""; ultimaCargaOrdenes = 0; filtroOrdenesInicial = true; reenviando.clear();
  if ($("admin-vista-ordenes")) { mostrarVistaAdmin("clientes"); actualizarAlertaOrdenes(); }
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
    saldos: saldoDisponible ? { USD: Number(fila[CONFIG.COL_SALDO]) || 0, ARS: Number(fila[CONFIG.COL_SALDO_ARS]) || 0 } : null,
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
  const verOrdenes = creaBoton("🧾 Ver sus órdenes", "background:#1d2740;color:#7dd3fc;border:1px solid #3f557f;margin-top:6px;padding:6px 10px;font-size:12px;");
  verOrdenes.addEventListener("click", () => {
    if ($("ord-buscar")) $("ord-buscar").value = clienteSel.email && clienteSel.email !== "-" ? clienteSel.email : clienteSel.etiqueta;
    if ($("ord-filtro")) $("ord-filtro").value = "todas";
    filtroOrdenesInicial = false;
    mostrarVistaAdmin("ordenes");
  });
  cab.append(nombre, sub, verOrdenes);
  vista.appendChild(cab);

  // --- Saldos (USD y ARS, independientes) ---
  if (clienteSel.saldos) {
    const caja = document.createElement("div");
    caja.style.cssText = "background:#161822;border:1px solid #2b3544;border-radius:10px;padding:10px;margin-bottom:10px;";

    const tiles = document.createElement("div");
    tiles.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;";
    [["USD", "Saldo USD", "#2ecc71"], ["ARS", "Saldo ARS", "#38bdf8"]].forEach(([m, titulo, color]) => {
      const t = document.createElement("div");
      t.id = "admin-tile-" + m;
      t.style.cssText = "background:#0e0f16;border:1px solid #2b3544;border-radius:8px;padding:8px 10px;";
      const l = document.createElement("div");
      l.style.cssText = "font-size:10px;letter-spacing:.5px;color:#8b93a7;text-transform:uppercase;";
      l.textContent = titulo;
      const v = document.createElement("div");
      v.id = "admin-saldo-" + m;
      v.style.cssText = `font-size:17px;font-weight:800;color:${color};margin-top:2px;word-break:break-all;`;
      v.textContent = (m === "ARS" && !saldoArsDisponible) ? "No habilitado" : formatoMoneda(m, clienteSel.saldos[m]);
      t.append(l, v);
      tiles.appendChild(t);
    });

    const fila = document.createElement("div");
    fila.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;";
    const moneda = document.createElement("select");
    moneda.id = "admin-moneda";
    moneda.setAttribute("aria-label", "Moneda a modificar");
    moneda.style.cssText = ESTILO_INPUT + "font-weight:700;";
    [["USD", "USD (dólares)"], ["ARS", "ARS (pesos)"]].forEach(([v, t]) => {
      const o = document.createElement("option"); o.value = v; o.textContent = t;
      if (v === "ARS" && !saldoArsDisponible) o.disabled = true;
      moneda.appendChild(o);
    });
    const modo = document.createElement("select");
    modo.id = "admin-modo";
    modo.setAttribute("aria-label", "Tipo de ajuste");
    modo.style.cssText = ESTILO_INPUT;
    [["sumar", "Sumar / restar"], ["establecer", "Establecer total"]].forEach(([v, t]) => {
      const o = document.createElement("option"); o.value = v; o.textContent = t; modo.appendChild(o);
    });
    const monto = document.createElement("input");
    monto.id = "admin-monto"; monto.type = "number"; monto.step = "0.01"; monto.placeholder = "Monto USD";
    monto.setAttribute("aria-label", "Monto");
    monto.style.cssText = ESTILO_INPUT + "width:120px;";
    const nota = document.createElement("input");
    nota.id = "admin-nota"; nota.type = "text"; nota.maxLength = 120; nota.placeholder = "Nota (opcional)";
    nota.style.cssText = ESTILO_INPUT + "flex:1;min-width:120px;";
    const ok = creaBoton("Acreditar / Cargar Saldo", "background:#2ecc71;color:#000;");
    ok.id = "admin-btn-saldo";
    ok.addEventListener("click", ajustarSaldoCliente);

    const resaltar = () => {
      const m = moneda.value;
      monto.placeholder = "Monto " + m;
      ["USD", "ARS"].forEach((x) => {
        const t = $("admin-tile-" + x);
        if (t) t.style.borderColor = x === m ? "#f3ba2f" : "#2b3544";
      });
    };
    moneda.addEventListener("change", resaltar);
    fila.append(moneda, modo, monto, nota, ok);
    caja.append(tiles, fila);
    vista.appendChild(caja);
    resaltar();
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
        img.addEventListener("load", () => seguirAbajo(cont));
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
  if (alFinal) irAlFinal(cont);
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
  const moneda = $("admin-moneda").value === "ARS" ? "ARS" : "USD";
  const modo = $("admin-modo").value;
  const monto = Math.round(parseFloat($("admin-monto").value) * 100) / 100;
  const nota = $("admin-nota").value.trim();
  const limite = moneda === "ARS" ? 100000000 : 100000;

  if (!Number.isFinite(monto) || monto === 0 && modo === "sumar") return mostrarAviso("Ingresá un monto válido.", "error");
  if (Math.abs(monto) > limite) return mostrarAviso("El monto es demasiado alto.", "error");
  if (modo === "establecer" && monto < 0) return mostrarAviso("El saldo total no puede ser negativo.", "error");

  const actual = sel.saldos[moneda];
  const despues = modo === "sumar" ? actual + monto : monto;
  if (despues < 0) return mostrarAviso(`El saldo ${moneda} no puede quedar negativo.`, "error");

  const confirmado = await mostrarConfirmacion({
    tono: modo === "sumar" && monto < 0 ? "warn" : "ok",
    icono: modo === "sumar" && monto < 0 ? "➖" : "💰",
    titulo: modo === "establecer" ? "Establecer saldo" : monto >= 0 ? "Acreditar saldo" : "Descontar saldo",
    texto: `Cliente: ${sel.etiqueta}`,
    filas: [
      ["Moneda", moneda === "ARS" ? "Pesos argentinos (ARS)" : "Dólares (USD)"],
      ["Saldo actual", conCodigo(moneda, actual)],
      [modo === "establecer" ? "Nuevo saldo" : monto >= 0 ? "Se suma" : "Se resta", modo === "establecer" ? conCodigo(moneda, monto) : conCodigo(moneda, Math.abs(monto))],
    ],
    total: ["Saldo resultante", conCodigo(moneda, despues)],
    confirmar: "Aplicar",
  });
  if (!confirmado) return;

  btn.disabled = true;
  try {
    const { data, error } = await supabase.rpc(RPC_SALDO, { p_user_id: sel.id, p_monto: monto, p_modo: modo, p_nota: nota || null, p_moneda: moneda });
    if (error) throw error;
    const nuevo = Number(data);
    sel.saldos[moneda] = nuevo;
    const tile = $("admin-saldo-" + moneda);
    if (tile) tile.textContent = formatoMoneda(moneda, nuevo);
    if (sel.fila) sel.fila[moneda === "ARS" ? CONFIG.COL_SALDO_ARS : CONFIG.COL_SALDO] = nuevo;
    tocarActividad(sel.id);
    if (usuarioActual && usuarioActual.id === sel.id) pintarSaldo(nuevo, moneda);
    $("admin-monto").value = ""; $("admin-nota").value = "";
    mostrarAviso(`Saldo ${moneda} actualizado: ${formatoMoneda(moneda, nuevo)}`, "ok");
  } catch (err) {
    console.error("Error al ajustar saldo:", err);
    mostrarAviso(
      err.code === "PGRST202" ? "Falta actualizar la función en Supabase: ejecutá doble_saldo.sql."
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
    #menu-mensaje{position:fixed;z-index:10001;width:max-content;min-width:236px;max-width:calc(100vw - 16px);background:#161822;
      border:1px solid #f3ba2f;border-radius:14px;box-shadow:0 10px 32px rgba(0,0,0,.75);padding:8px;font-size:13px;color:#fff}
    #menu-mensaje .mm-emojis{display:flex;justify-content:space-between;gap:2px;padding:2px 0 8px;margin-bottom:6px;border-bottom:1px solid #2b3544}
    #menu-mensaje .mm-emoji{background:none;border:none;font-size:22px;line-height:1;cursor:pointer;border-radius:8px;padding:5px 6px}
    #menu-mensaje .mm-acciones{display:flex;gap:4px}
    #menu-mensaje .mm-item{flex:1 1 0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;text-align:center;
      background:rgba(255,255,255,.04);border:none;color:#fff;padding:8px 6px;border-radius:9px;cursor:pointer;font-size:11.5px;font-weight:600}
    #menu-mensaje .mm-ico{font-size:18px;line-height:1}
    #menu-mensaje .mm-item:hover,#menu-mensaje .mm-item:focus-visible,#menu-mensaje .mm-emoji:hover,#menu-mensaje .mm-emoji:focus-visible{
      background:rgba(243,186,47,.22);color:#f3ba2f;outline:none}
    #menu-mensaje .mm-nota{font-size:11px;color:#888;padding:6px 9px 2px}
    #menu-mensaje.mm-hoja{width:auto;min-width:0;max-width:none;border-radius:16px 16px 12px 12px;padding:10px}
    #menu-mensaje.mm-hoja .mm-emoji{font-size:26px;padding:6px 8px}
    #menu-mensaje.mm-hoja .mm-item{padding:11px 6px;font-size:12px}
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

// El menú nunca tapa el mensaje elegido:
//  - celulares: hoja fija abajo; el mensaje se desplaza para quedar por encima
//  - PC: debajo o arriba del mensaje; si no entra, se centra el mensaje o se pone al costado
let ignorarScrollHasta = 0;
const enCelular = () => window.matchMedia("(max-width: 600px)").matches;

function mantenerVisible(burbuja) {
  ignorarScrollHasta = Date.now() + 700;   // nuestro propio scroll no debe cerrar el menú
  burbuja.scrollIntoView({ block: "center", behavior: "auto" });
}

function posicionarMenu(menu, burbuja) {
  const M = 8;
  const vv = window.visualViewport;
  const vw = vv ? vv.width : window.innerWidth;
  const vh = vv ? vv.height : window.innerHeight;
  const rect = () => burbuja.getBoundingClientRect();

  if (enCelular()) {
    menu.classList.add("mm-hoja");
    menu.style.cssText += `;left:${M}px;right:${M}px;bottom:${M}px;top:auto;`;
    const inicioHoja = vh - menu.offsetHeight - M;
    let r = rect();
    if (r.bottom > inicioHoja - 6 || r.top < 70) {
      mantenerVisible(burbuja);
      r = rect();
      if (r.bottom > inicioHoja - 6) { ignorarScrollHasta = Date.now() + 700; window.scrollBy(0, r.bottom - inicioHoja + 6); }
    }
    return;
  }

  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  const colocar = (top, left) => {
    menu.style.top = Math.max(M, Math.min(top, vh - mh - M)) + "px";
    menu.style.left = Math.max(M, Math.min(left, vw - mw - M)) + "px";
  };
  let r = rect();
  const alineado = () => r.right - mw;
  if (mh + 6 <= vh - r.bottom - M) return colocar(r.bottom + 6, alineado());
  if (mh + 6 <= r.top - M) return colocar(r.top - mh - 6, alineado());

  // no entra ni arriba ni abajo: centramos el mensaje y reintentamos
  mantenerVisible(burbuja);
  r = rect();
  if (mh + 6 <= vh - r.bottom - M) return colocar(r.bottom + 6, alineado());
  if (mh + 6 <= r.top - M) return colocar(r.top - mh - 6, alineado());
  // mensaje muy alto: el menú va al costado
  if (r.left - mw - 6 >= M) return colocar(r.top, r.left - mw - 6);
  if (r.right + mw + 6 <= vw - M) return colocar(r.top, r.right + 6);
  colocar(vh - mh - M, alineado());
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
    const ic = document.createElement("span"); ic.className = "mm-ico"; ic.textContent = icono;
    const lb = document.createElement("span"); lb.textContent = etiqueta;
    b.append(ic, lb);
    b.addEventListener("click", () => { cerrarMenuMensaje(); fn(); });
    acciones.appendChild(b);
  };
  const acciones = document.createElement("div");
  acciones.className = "mm-acciones";

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
  if (acciones.children.length) menu.appendChild(acciones);
  if (!menu.querySelector("[role=menuitem]") && !menu.querySelector(".mm-nota")) return;

  menu.style.visibility = "hidden";
  document.body.appendChild(menu);
  posicionarMenu(menu, burbuja);
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
document.addEventListener("scroll", (e) => {
  if (Date.now() < ignorarScrollHasta) return;
  if (menuAbierto && menuAbierto.menu.contains(e.target)) return;
  cerrarMenuMensaje();
}, true);
window.addEventListener("resize", cerrarMenuMensaje);
inyectarEstilosMensajes();

// ------------------------- DIÁLOGOS (confirmación, avisos, errores) -----
const TONOS = {
  ok:    { color: "#2ecc71", fondo: "rgba(46,204,113,.14)" },
  warn:  { color: "#f3ba2f", fondo: "rgba(243,186,47,.14)" },
  error: { color: "#ff5c5c", fondo: "rgba(255,92,92,.14)" },
  info:  { color: "#38bdf8", fondo: "rgba(56,189,248,.14)" },
};

function inyectarEstilosCompra() {
  if ($("estilos-compra")) return;
  const st = document.createElement("style");
  st.id = "estilos-compra";
  st.textContent = `
    #modal-compra{position:fixed;inset:0;z-index:10002;display:none;align-items:center;justify-content:center;padding:16px;
      background:radial-gradient(circle at 50% 30%,rgba(243,186,47,.10),rgba(0,0,0,.82) 60%);backdrop-filter:blur(3px);overflow-y:auto}
    #modal-compra .mc-card{position:relative;width:100%;max-width:400px;margin:auto;color:#fff;text-align:center;
      background:linear-gradient(180deg,#1b1d2b 0%,#12131c 100%);border:1px solid var(--tono,#f3ba2f);border-radius:18px;
      padding:26px 22px 20px;box-shadow:0 0 0 1px rgba(255,255,255,.04),0 18px 60px rgba(0,0,0,.75),0 0 38px var(--tono-fondo,rgba(243,186,47,.14));
      animation:mcentra .22s ease-out}
    @keyframes mcentra{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:none}}
    #modal-compra .mc-icono{width:64px;height:64px;margin:0 auto 12px;border-radius:50%;display:flex;align-items:center;justify-content:center;
      font-size:30px;line-height:1;background:var(--tono-fondo);border:2px solid var(--tono);box-shadow:0 0 22px var(--tono-fondo)}
    #modal-compra .mc-spin{width:42px;height:42px;margin:6px auto 16px;border:4px solid #2b3544;border-top-color:#f3ba2f;border-radius:50%;animation:mcgira .9s linear infinite}
    @keyframes mcgira{to{transform:rotate(360deg)}}
    #modal-compra h3{margin:0 0 6px;font-family:'Orbitron',sans-serif;font-size:1.02rem;letter-spacing:.4px;color:var(--tono,#f3ba2f)}
    #modal-compra .mc-texto{margin:0;font-size:13.5px;line-height:1.5;color:#c3cad8}
    #modal-compra .mc-chip{display:inline-flex;align-items:center;gap:6px;margin-top:12px;padding:6px 12px;border-radius:999px;font-size:12px;font-weight:700;
      background:rgba(46,204,113,.13);border:1px solid rgba(46,204,113,.45);color:#4ef38d}
    #modal-compra .mc-filas{margin:16px 0 0;padding:4px 14px;background:#0d0e15;border:1px solid #2a2d3d;border-radius:12px;text-align:left}
    #modal-compra .mc-fila{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:9px 0;font-size:13px;border-bottom:1px dashed #262a3a}
    #modal-compra .mc-fila:last-child{border-bottom:none}
    #modal-compra .mc-fila span{color:#8b93a7}
    #modal-compra .mc-fila b{color:#fff;font-weight:700;text-align:right;word-break:break-word}
    #modal-compra .mc-total{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:10px;padding:12px 14px;border-radius:12px;
      background:linear-gradient(135deg,rgba(46,204,113,.18),rgba(243,186,47,.10));border:1px solid rgba(46,204,113,.45)}
    #modal-compra .mc-total span{font-size:12px;color:#b8e8cb;text-transform:uppercase;letter-spacing:.5px}
    #modal-compra .mc-total b{font-family:'Orbitron',sans-serif;font-size:1.05rem;color:#4ef38d}
    #modal-compra .mc-nota{margin-top:10px;font-size:11.5px;color:#8b93a7;line-height:1.4}
    #modal-compra .mc-botones{display:flex;gap:10px;margin-top:18px}
    #modal-compra .mc-btn{flex:1;padding:12px 14px;border-radius:10px;border:1px solid #2f3447;background:#171926;color:#e5e9f2;
      font-weight:700;font-size:13.5px;cursor:pointer;transition:transform .1s,filter .15s}
    #modal-compra .mc-btn:hover{filter:brightness(1.15)}
    #modal-compra .mc-btn:active{transform:scale(.98)}
    #modal-compra .mc-btn.primario{border:none;color:#10120a;background:linear-gradient(135deg,#ffd45a,#f3ba2f)}
    #modal-compra .mc-btn.primario.verde{color:#04170c;background:linear-gradient(135deg,#4ef38d,#1fb865)}
    #modal-compra .mc-btn:focus-visible{outline:2px solid #fff;outline-offset:2px}
    @media (max-width:420px){#modal-compra .mc-botones{flex-direction:column-reverse}}
    .btn-buy[aria-disabled="true"]{opacity:.6;pointer-events:none}
    /* Evita el scroll horizontal en celulares: el carrusel no puede ensanchar la columna */
    .left-content-col,.right-widgets-col{min-width:0}
    #carousel-wrapper{max-width:100%;overflow:hidden}
  `;
  document.head.appendChild(st);
}

let dialogoResolver = null;
inyectarEstilosCompra();   // desde el inicio: incluye las reglas del header en celulares

// Toques en los primeros 350 ms de un diálogo: se ignoran (suelen ser el segundo toque de un doble toque)
const toqueFantasma = (ov) => Date.now() - Number(ov.dataset.desde || 0) < 350;

let focoPrevio = null;   // elemento que tenía el foco antes de abrir el diálogo
function ocultarDialogo(ov) {
  ov.style.display = "none";
  const f = focoPrevio;
  focoPrevio = null;
  if (f && document.contains(f) && typeof f.focus === "function") { try { f.focus({ preventScroll: true }); } catch (_) { /* nada */ } }
}

function cerrarCompra() {
  const ov = $("modal-compra");
  if (ov) ocultarDialogo(ov);
  if (dialogoResolver) { const r = dialogoResolver; dialogoResolver = null; r(false); }
}

// Dibuja un diálogo. botones: [{ texto, primario, verde, valor, accion }]
function mostrarDialogo({ tono = "warn", icono = "", titulo, texto = "", chip = "", filas = [], total = null, nota = "", cargando = false, botones = [] }) {
  inyectarEstilosCompra();
  let ov = $("modal-compra");
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "modal-compra";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.addEventListener("click", (e) => { if (e.target === ov && !ov.dataset.bloqueado && !toqueFantasma(ov)) cerrarCompra(); });
    document.body.appendChild(ov);
  }
  const t = TONOS[tono] || TONOS.warn;
  ov.replaceChildren();
  const card = document.createElement("div");
  card.className = "mc-card";
  card.style.setProperty("--tono", t.color);
  card.style.setProperty("--tono-fondo", t.fondo);
  card.setAttribute("aria-live", "polite");

  if (cargando) {
    const sp = document.createElement("div"); sp.className = "mc-spin"; card.appendChild(sp);
  } else if (icono) {
    const ic = document.createElement("div"); ic.className = "mc-icono"; ic.textContent = icono; card.appendChild(ic);
  }
  const h = document.createElement("h3"); h.textContent = titulo; card.appendChild(h);
  if (texto) { const p = document.createElement("p"); p.className = "mc-texto"; p.textContent = texto; card.appendChild(p); }
  if (chip) { const c = document.createElement("div"); c.className = "mc-chip"; c.textContent = chip; card.appendChild(c); }
  if (filas.length) {
    const box = document.createElement("div"); box.className = "mc-filas";
    filas.forEach(([k, v]) => {
      const f = document.createElement("div"); f.className = "mc-fila";
      const a = document.createElement("span"); a.textContent = k;
      const b = document.createElement("b"); b.textContent = v;
      f.append(a, b); box.appendChild(f);
    });
    card.appendChild(box);
  }
  if (total) {
    const tt = document.createElement("div"); tt.className = "mc-total";
    const a = document.createElement("span"); a.textContent = total[0];
    const b = document.createElement("b"); b.textContent = total[1];
    tt.append(a, b); card.appendChild(tt);
  }
  if (nota) { const n = document.createElement("div"); n.className = "mc-nota"; n.textContent = nota; card.appendChild(n); }
  if (botones.length) {
    const fila = document.createElement("div"); fila.className = "mc-botones";
    botones.forEach((b) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "mc-btn" + (b.primario ? " primario" : "") + (b.verde ? " verde" : "");
      el.textContent = b.texto;
      el.addEventListener("click", () => {
        if (toqueFantasma(ov)) return;   // doble toque sobre COMPRAR: el 2.º no debe caer sobre el diálogo recién abierto
        const r = dialogoResolver; dialogoResolver = null;
        ocultarDialogo(ov);
        if (b.accion) b.accion();
        if (r) r(b.valor === undefined ? true : b.valor);
      });
      fila.appendChild(el);
    });
    card.appendChild(fila);
  }
  ov.appendChild(card);
  ov.dataset.bloqueado = cargando ? "1" : "";
  ov.dataset.desde = String(Date.now());
  if (ov.style.display !== "flex") focoPrevio = document.activeElement;
  ov.style.display = "flex";
  (card.querySelector(".mc-btn.primario") || card.querySelector("button"))?.focus();
}

// Confirmación con promesa: true si el usuario confirma
function mostrarConfirmacion({ tono = "warn", icono = "❓", titulo, texto, filas, total, nota, confirmar = "Confirmar", cancelar = "Cancelar" }) {
  return new Promise((resolve) => {
    dialogoResolver = resolve;
    mostrarDialogo({
      tono, icono, titulo, texto, filas, total, nota,
      botones: [
        { texto: cancelar, valor: false },
        { texto: confirmar, primario: true, verde: tono === "ok", valor: true },
      ],
    });
  });
}

document.addEventListener("keydown", (e) => {
  const ov = $("modal-compra");
  if (!ov || ov.style.display !== "flex") return;
  if (e.key === "Escape" && !ov.dataset.bloqueado) cerrarCompra();
  if (e.key === "Tab") {   // el foco no se escapa a la página que está detrás del diálogo
    e.preventDefault();
    const bs = [...ov.querySelectorAll("button")];
    if (!bs.length) return;
    const i = bs.indexOf(document.activeElement);
    bs[e.shiftKey ? (i <= 0 ? bs.length - 1 : i - 1) : (i === bs.length - 1 ? 0 : i + 1)].focus();
  }
});

// ------------------------- COMPRA DE PAQUETES CON SALDO ---------------
// El PIN NUNCA llega al navegador: la base de datos lo reserva y avisa a n8n por su cuenta.
const RPC_COMPRA = "comprar_paquete";
let comprando = false;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// "USD 0,86" -> 0.86   |   "ARS $1.463" -> 1463
function precioDeCaja(caja) {
  const t = (caja.querySelector(".price")?.textContent || "").replace(/[^\d,.]/g, "");
  const n = parseFloat(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

async function esperarOrden(ordenId) {
  const fin = Date.now() + CONFIG.ESPERA_ORDEN_MS;
  while (Date.now() < fin) {
    await dormir(2000);
    let respuesta;
    try { respuesta = await conTimeout(supabase.from("ordenes_recarga").select("estado").eq("id", ordenId).maybeSingle(), 8000); }
    catch (_) { continue; }   // una consulta colgada no frena la espera
    const { data, error } = respuesta;
    if (error || !data) continue;
    if (data.estado === "completada" || data.estado === "fallida") return data.estado;
    if (data.estado === "error_envio") return "pendiente";   // no tiene sentido seguir esperando
  }
  return "pendiente";
}

function irAlChat(texto) {
  prepararMensajeChat(texto);
}

function mostrarErrorCompra(error, { moneda, saldo, precio, nombre, id }) {
  const msg = String((error && error.message) || "");
  const cerrar = [{ texto: "Cerrar", primario: true }];
  const caso = (opts) => mostrarDialogo({ botones: cerrar, ...opts });
  const intactoChip = "No se descontó nada de tu saldo";

  if (msg.includes("SALDO_INSUFICIENTE")) {
    const falta = precio != null ? Math.max(0, precio - saldo) : null;
    return mostrarDialogo({
      tono: "warn", icono: "👛", titulo: "Saldo insuficiente",
      texto: `Necesitás más saldo en ${moneda === "ARS" ? "pesos" : "dólares"} para comprar este paquete.`,
      filas: [
        ["Tu saldo " + moneda, formatoMoneda(moneda, saldo)],
        ...(precio != null ? [["Precio del paquete", formatoMoneda(moneda, precio)]] : []),
        ...(falta != null ? [["Te faltan", formatoMoneda(moneda, falta)]] : []),
      ],
      chip: intactoChip,
      botones: [
        { texto: "Cerrar", valor: false },
        { texto: "Cargar saldo", primario: true, accion: () => abrirModalSeleccionCarga() },
      ],
    });
  }
  if (msg.includes("SIN_STOCK")) {
    return mostrarDialogo({
      tono: "warn", icono: "📦", titulo: "Paquete agotado",
      texto: `Por el momento no tenemos stock de ${nombre}. Estamos reponiendo: escribinos por el chat y te avisamos apenas esté disponible.`,
      chip: intactoChip,
      botones: [
        { texto: "Cerrar", valor: false },
        { texto: "Avisarme por el chat", primario: true, accion: () => irAlChat(`Hola! ${nombre} figura agotado. ¿Cuándo vuelve a haber stock? Mi ID: ${id}`) },
      ],
    });
  }
  if (msg.includes("PRECIO_CAMBIO")) return caso({ tono: "info", icono: "🏷️", titulo: "El precio cambió", texto: "El precio de este paquete se actualizó. Recargá la página para ver el valor vigente.", chip: intactoChip });
  if (msg.includes("ID_INVALIDO")) return caso({ tono: "error", icono: "🆔", titulo: "ID inválido", texto: "Revisá tu ID de jugador de Free Fire (solo números)." });
  if (msg.includes("NO_AUTENTICADO")) return caso({ tono: "info", icono: "🔒", titulo: "Sesión vencida", texto: "Volvé a iniciar sesión con Google para comprar." });
  if (msg.includes("PAQUETE_INVALIDO")) return caso({ tono: "warn", icono: "🚫", titulo: "Paquete no disponible", texto: "Este paquete no está disponible por el momento." });
  if (msg.includes("MONEDA_NO_DISPONIBLE") || msg.includes("MONEDA_INVALIDA")) return caso({ tono: "warn", icono: "💱", titulo: "Moneda no disponible", texto: "Este paquete todavía no se vende en esa moneda. Escribinos por el chat.", chip: intactoChip });
  if (error && error.code === "PGRST202") {
    console.warn("Falta la función comprar_paquete con moneda: ejecutá pines_y_compras.sql y doble_saldo.sql en Supabase.");
    return caso({ tono: "info", icono: "🛠️", titulo: "Compra no disponible", texto: "La compra con saldo todavía no está habilitada. Escribinos por el chat." });
  }
  console.error("Error en la compra:", error);
  return caso({ tono: "error", icono: "⚠️", titulo: "No pudimos completar la compra", texto: "Ocurrió un problema. Revisá tu saldo antes de reintentar o escribinos por el chat." });
}

async function comprarPaquete(ev, paqueteId, moneda = "USD") {
  if (ev && ev.preventDefault) ev.preventDefault();
  if (comprando) return;
  const btn = ev && ev.currentTarget;
  moneda = moneda === "ARS" ? "ARS" : "USD";

  if (!usuarioActual) {
    mostrarAviso("Iniciá sesión con Google para comprar con tu saldo.", "error");
    if (!$("sidebar-menu")?.classList.contains("open")) toggleMenu();
    return;
  }
  const id = ($("player-id")?.value || "").trim();
  if (!/^\d{5,15}$/.test(id)) {
    mostrarAviso("Primero ingresá tu ID de jugador de Free Fire.", "error");
    $("player-id")?.scrollIntoView({ behavior: "smooth", block: "center" });
    $("player-id")?.focus();
    return;
  }

  const caja = btn ? btn.closest(".diamond-box") : null;
  const nombre = caja?.querySelector("h4")?.textContent.trim() || paqueteId;
  const precio = caja ? precioDeCaja(caja) : null;
  const nick = jugadorVerificado && jugadorVerificado.validado && jugadorVerificado.id === id ? jugadorVerificado.nombre : null;

  comprando = true;
  btn?.setAttribute("aria-disabled", "true");
  const ctxError = { moneda, saldo: saldos[moneda], precio, nombre, id };
  try {
    // saldo al día antes de confirmar (puede haberse acreditado recién); si tarda, se sigue con el que está en pantalla
    try { await conTimeout(cargarSaldo(usuarioActual), 8000); } catch (_) { /* sin bloqueo */ }
    ctxError.saldo = saldos[moneda];
    const saldo = saldos[moneda];

    if (precio != null && saldo < precio) return mostrarErrorCompra({ message: "SALDO_INSUFICIENTE" }, ctxError);

    const confirmado = await mostrarConfirmacion({
      tono: "ok", icono: "💎", titulo: "Confirmá tu compra",
      texto: "Revisá los datos antes de continuar.",
      filas: [
        ["Paquete", nombre],
        ["ID de Free Fire", id + (nick ? ` (${nick})` : "")],
        ["Tu saldo " + moneda, formatoMoneda(moneda, saldo)],
        ...(precio != null ? [["Saldo luego de comprar", formatoMoneda(moneda, saldo - precio)]] : []),
      ],
      total: precio != null ? ["Total a pagar", conCodigo(moneda, precio)] : null,
      nota: "Verificá bien el ID: la recarga no se puede cambiar de cuenta una vez enviada.",
      confirmar: "Confirmar compra",
    });
    if (!confirmado) return;

    mostrarDialogo({ tono: "warn", titulo: "Procesando tu compra…", texto: "No cierres esta ventana.", cargando: true });

    const { data, error } = await conTimeout(supabase.rpc(RPC_COMPRA, {
      p_paquete_id: paqueteId,
      p_id_jugador: id,
      p_moneda: moneda,
      p_precio_esperado: precio,
    }), 30000);
    if (error) return mostrarErrorCompra(error, ctxError);

    const orden = data || {};
    const monedaOrden = orden.moneda === "ARS" ? "ARS" : moneda;
    if (Number.isFinite(Number(orden.saldo_nuevo))) pintarSaldo(Number(orden.saldo_nuevo), monedaOrden);
    const nombrePaquete = orden.paquete || nombre;

    let estado = "completada";
    if (CONFIG.ESPERAR_CONFIRMACION) {
      mostrarDialogo({ tono: "warn", titulo: "Acreditando tus diamantes…", texto: `${nombrePaquete} para el ID ${id}`, cargando: true });
      estado = await esperarOrden(orden.orden_id);
    }

    if (estado === "completada") {
      mostrarDialogo({
        tono: "ok", icono: "✅", titulo: "¡Compra exitosa!",
        texto: `Tus ${nombrePaquete} 💎 fueron acreditados a tu ID de Free Fire ${id}.`,
        filas: [["Orden", "#" + orden.orden_id], ["Saldo " + monedaOrden, formatoMoneda(monedaOrden, saldos[monedaOrden])]],
        botones: [{ texto: "Genial", primario: true, verde: true }],
      });
    } else if (estado === "fallida") {
      cargarSaldo(usuarioActual);   // el saldo ya fue devuelto: se refleja en pantalla
      mostrarDialogo({
        tono: "error", icono: "⚠️", titulo: "No pudimos acreditar tus diamantes",
        texto: "Probá de nuevo en unos minutos o escribinos por el chat.",
        chip: "Tu saldo fue devuelto",
        botones: [{ texto: "Cerrar", primario: true }],
      });
    } else {
      mostrarDialogo({
        tono: "info", icono: "⏳", titulo: "Compra registrada",
        texto: `Tu pedido #${orden.orden_id} está en proceso. Tus diamantes se acreditan en unos minutos. Si tarda, escribinos por el chat.`,
        botones: [{ texto: "Entendido", primario: true }],
      });
    }
  } catch (err) {
    console.error("Error de red en la compra:", err);
    cargarSaldo(usuarioActual);
    mostrarDialogo({
      tono: "error", icono: "📡", titulo: "No pudimos confirmar la compra",
      texto: "Revisá tu saldo antes de reintentar, así evitás pagar dos veces. Si se descontó, tu pedido está en proceso.",
      botones: [{ texto: "Cerrar", primario: true }],
    });
  } finally {
    comprando = false;
    btn?.removeAttribute("aria-disabled");
    if (comprasAbierto()) cargarHistorialCompras(true);
  }
}

function notificarLogin(user) {
  const clave = "loginNotificado:" + user.id;
  try {
    if (sessionStorage.getItem(clave)) return;
    sessionStorage.setItem(clave, "1");
  } catch (_) { /* sessionStorage bloqueado: seguimos igual */ }
  if (!CONFIG.WEBHOOK_EVENTOS_URL) return;
  postWebhook({ tipo_evento: "LOGIN", user_id: user.id, email: user.email, fecha: new Date().toISOString() }, 10000, CONFIG.WEBHOOK_EVENTOS_URL)
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
  $("player-id")?.addEventListener("input", alEditarId);
  iniciarHistorialAdmin();
  iniciarHistorialCompras();

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
  toggleMenu, agregarPinesStock,
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
  comprarPaquete,
  mostrarVistaAdmin,
  alternarHistorial, abrirHistorial,
  loginConGoogle, logoutGoogle,
});
