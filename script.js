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
  ESPERA_ORDEN_MS: 30000,
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
  try { if (tipo === "ok") sfx("ok"); else if (tipo === "error") sfx("error"); } catch (_) {}
  div.style.cssText =
    "animation:zToast .32s cubic-bezier(.2,1,.3,1);position:fixed;left:50%;bottom:90px;transform:translateX(-50%);max-width:90%;" +
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
const formatoARS = (n) => "$" + Math.floor(Number(n) || 0).toLocaleString("es-AR", { maximumFractionDigits: 0 });   // pesos sin centavos
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
  try { sfx(abierto ? "abrir" : "cerrar"); } catch (_) {}
  overlay.classList.toggle("open", abierto);
  document.body.style.overflow = abierto ? "hidden" : "";
}

// ------------------------- MODALES DE SALDO --------------------------
function mostrarModal(id, visible) {
  const el = $(id);
  try { if (el && visible !== (el.style.display === "flex")) sfx(visible ? "abrir" : "cerrar"); } catch (_) {}
  if (el) el.style.display = visible ? "flex" : "none";
}
function cerrarTodosLosModales() {
  ["modal-seleccion-carga", "modal-binance", "modal-mercadopago", "modal-convertir"].forEach((id) => mostrarModal(id, false));
}
function avisarTarjetaProximamente() { mostrarAviso("💳 Muy pronto vas a poder cargar saldo con tarjeta, sin esperar a nadie.", "info"); }
function abrirModalSeleccionCarga() {
  cerrarTodosLosModales();
  try {   // muestra tu saldo actual arriba (lo mismo que ves en la cabecera)
    const ars = $("header-balance-ars"), usd = $("header-balance-amount");
    if ($("cg-s-ars") && ars) $("cg-s-ars").textContent = ars.textContent || "$0";
    if ($("cg-s-usd") && usd) $("cg-s-usd").textContent = "$" + String(usd.textContent || "0").replace(/^\$/, "");
  } catch (_) {}
  mostrarModal("modal-seleccion-carga", true);
}
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
  if (window.innerWidth <= 800 && typeof alternarChat === "function") alternarChat(true);
}

function copiarDato(id, btn) {
  const t = $(id)?.textContent || "";
  const ok = () => { if (btn) { const o = btn.innerHTML; btn.classList.add("ok"); btn.innerHTML = '<i class="fa-solid fa-check"></i> ¡Copiado!'; setTimeout(() => { btn.classList.remove("ok"); btn.innerHTML = o; }, 1800); } };
  (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(ok).catch(() => {
    const r = document.createRange(); r.selectNodeContents($(id)); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    try { document.execCommand("copy"); ok(); } catch (e) { /* queda seleccionado */ }
  });
}
function elegirMonto(inputId, valor) {
  const i = $(inputId); if (i) i.value = valor;
  i?.closest(".pay-box")?.querySelectorAll(".pay-chip").forEach((b) => b.classList.toggle("sel", b.textContent.replace(/\D/g, "") === String(valor)));
}

function procesarCarga({ inputId, moneda, metodo, url, modalCerrar, minimo = 0 }) {
  const monto = parseFloat($(inputId)?.value);
  if (!(monto > 0)) return mostrarAviso("Elegí o escribí el monto que enviaste.", "error");
  if (monto < minimo) return mostrarAviso(`El monto mínimo es ${minimo} ${moneda}.`, "error");
  if (!usuarioActual) {
    cerrarTodosLosModales();
    mostrarAviso("Iniciá sesión con Google para cargar saldo.", "error");
    if (!$("sidebar-menu")?.classList.contains("open")) toggleMenu();
    return;
  }
  modalCerrar();
  prepararMensajeChat(`Hola! Quiero cargar ${monto} ${moneda} con ${metodo}. Ahora te envío el comprobante.`);
  mostrarAviso("Realizá el pago y enviá el comprobante por el chat.", "ok");
}

function procesarPagoBinanceSeguro() {
  procesarCarga({ inputId: "monto-usdt", moneda: "USD", metodo: "Binance USDT", minimo: 10, modalCerrar: cerrarModalBinance });
}
function procesarPagoMPSeguro() {
  procesarCarga({ inputId: "monto-mp", moneda: "ARS", metodo: "Mercado Pago", minimo: 0, modalCerrar: cerrarModalMercadoPagoSaldo });
}

// ------------------------- CARRUSEL ----------------------------------
let slideActual = 2;
let timerCarrusel = null;
let esperaAyuda = false;
let carruselPausado = false;

function renderCarrusel() {
  const slides = document.querySelectorAll("#carousel-track .carousel-slide");
  const caja = document.getElementById("carousel-dots");
  const n = slides.length;
  if (!n) return;
  if (caja) {   // un puntito por cada slide, siempre
    while (caja.children.length < n) { const d = document.createElement("span"); d.className = "dot"; const k = caja.children.length; d.addEventListener("click", () => irASlide(k)); caja.appendChild(d); }
    while (caja.children.length > n) caja.lastElementChild.remove();
  }
  const dots = caja ? caja.querySelectorAll(".dot") : [];
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
    if (carruselPausado) return;
    const act = document.querySelector("#carousel-track .carousel-slide.active");
    if (act && act.classList.contains("slide-ayuda") && !esperaAyuda) { esperaAyuda = true; return; }   // la guía se queda el doble de tiempo
    esperaAyuda = false;
    if (n) { slideActual = (slideActual + 1) % n; renderCarrusel(); }
  }, 5000);
}

// ------------------------- MÉTODO DE PAGO ----------------------------
function seleccionarMetodo(metodo) {
  const esMP = metodo === "mp";
  try { const yaEra = $("card-mp")?.classList.contains("active") === esMP; if (!yaEra) sfx("abrir"); } catch (_) {}
  $("card-mp")?.classList.toggle("active", esMP);
  $("card-binance")?.classList.toggle("active", !esMP);
  const gMP = $("grid-mp");
  const gBN = $("grid-binance");
  if (gMP) gMP.style.display = esMP ? "block" : "none";
  if (gBN) gBN.style.display = esMP ? "none" : "block";
  const g = esMP ? gMP : gBN;   // los paquetes bajan con suavidad, uno detrás de otro
  if (g) { g.classList.remove("z-baja"); void g.offsetWidth; g.classList.add("z-baja"); }
}

// ------------------------- VERIFICAR JUGADOR -------------------------
let jugadorVerificado = null;
let verifSinNombre = 0;
const CLAVE_NOMBRES = "zarela_nombres";
function nombreGuardado(id) {
  try { const m = JSON.parse(localStorage.getItem(CLAVE_NOMBRES) || "{}"); if (m[id]) return String(m[id]).slice(0, 32); } catch (_) {}
  try { const x = (typeof idsGuardados !== "undefined" ? idsGuardados : []).find((y) => y.id_jugador === id && y.apodo); if (x) return String(x.apodo).slice(0, 32); } catch (_) {}
  return "";
}
function recordarNombre(id, nombre) { if (!nombre) return; try { const m = JSON.parse(localStorage.getItem(CLAVE_NOMBRES) || "{}"); m[id] = nombre; const k = Object.keys(m); if (k.length > 60) delete m[k[0]]; localStorage.setItem(CLAVE_NOMBRES, JSON.stringify(m)); } catch (_) {} }   // última vez que no se pudo traer el nombre (0 = andaba bien)

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
  card.querySelector(".player-label").textContent = validado ? "Jugador encontrado" : "ID listo para recargar";

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

  // Nombre confirmado por Zarela (registro propio): sale en una fracción de segundo, sin esperar a los servicios externos
  let confirmado = "";
  const regP = conTimeout(Promise.resolve(supabase.rpc("nombre_id", { p_id: id })), 4000).then((r) => (r && r.data ? String(r.data).slice(0, 40) : ""), () => "");
  regP.then((n) => {
    if (!n || mi !== verifSeq || jugadorVerificado) return;
    confirmado = n; recordarNombre(id, n);
    pintarJugador({ nombre: n, avatar: "", banner: "", nivel: null, region: "" }, id, true);
    jugadorVerificado = { id, nombre: n, validado: true };
    estadoVerificacion("ID verificado correctamente.", "ok");
    btn.disabled = false;
  });
  const previo = nombreGuardado(id);   // nombre visto antes en este dispositivo: se muestra ya mismo mientras se confirma
  if (previo) {   // ya lo conocemos: se muestra al instante y se busca la foto/banner en segundo plano, sin cartel de "Verificando"
    pintarJugador({ nombre: previo, avatar: "", banner: "", nivel: null, region: "" }, id, true); jugadorVerificado = { id, nombre: previo, validado: false };
    estadoVerificacion("ID verificado correctamente.", "ok"); btn.disabled = false;
  }

  // Si no se puede validar el nombre, el ID igual queda cargado para el pedido (modo manual)
  const modoManual = async (motivo) => {
    if (mi !== verifSeq) return;
    console.warn("Verificación automática no disponible:", motivo);
    confirmado = confirmado || (await regP);
    if (mi !== verifSeq) return;
    if (confirmado) {   // ya está confirmado en el registro: no hace falta nada más
      if (!jugadorVerificado || !jugadorVerificado.validado) { pintarJugador({ nombre: confirmado, avatar: "", banner: "", nivel: null, region: "" }, id, true); jugadorVerificado = { id, nombre: confirmado, validado: true }; }
      estadoVerificacion("ID verificado correctamente.", "ok"); return;
    }
    if (jugadorVerificado && jugadorVerificado.id === id && jugadorVerificado.nombre) { estadoVerificacion("ID verificado correctamente.", "ok"); return; }
    verifSinNombre = Date.now();
    const guardado = nombreGuardado(id);   // nombre que ya se había visto antes de este ID (cache o "Mis ID guardados")
    if (guardado) {
      pintarJugador({ nombre: guardado, avatar: "", banner: "", nivel: null, region: "" }, id, true);
      const pm = $("player-meta"); if (pm) pm.textContent = "Nombre guardado de antes · ID " + id;
      jugadorVerificado = { id, nombre: guardado, validado: false };
      estadoVerificacion("ID cargado con el nombre guardado de antes. Revisá que sea correcto antes de comprar.", "ok");
      return;
    }
    pintarJugador({}, id, false);
    jugadorVerificado = { id, nombre: null, validado: false };
    estadoVerificacion("ID cargado. Todavía no conocemos tu nombre: la próxima vez que recargues, va a aparecer acá. Podés comprar tranquilo, la recarga va a ese ID.", "ok");
  };

  try {
    const res = await postWebhook({ tipo_evento: "VERIFICAR_JUGADOR", id_jugador: id, playerId: id, region: "SAC" }, 9000);
    if (mi !== verifSeq) return;   // el usuario cambió el ID o volvió a tocar Verificar
    if (!res.ok) return modoManual("HTTP " + res.status);

    let crudo = null;
    try { crudo = await conTimeout(res.json(), 8000); } catch (_) { return modoManual("respuesta sin JSON"); }
    if (mi !== verifSeq) return;

    const info = normalizarJugador(crudo);
    if (info.noEncontrado) {   // n8n avisó explícitamente que el ID no existe
      jugadorVerificado = { id, nombre: null, validado: false, noEncontrado: true };
      estadoVerificacion("ID no encontrado. Revisá que esté bien escrito: si es de otra región (no Latinoamérica), no se puede recargar.", "error");
      return;
    }
    if (!tieneEvidencia(info)) return modoManual("el webhook no devolvió datos del jugador");

    pintarJugador(info, id, true);
    verifSinNombre = 0;
    recordarNombre(id, info.nombre);
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
// Lista de temas: musica.mp3, musica2.mp3, musica3.mp3… (hasta musica12.mp3). Solo hay que subir los archivos
// a la carpeta de la página con esos nombres: el reproductor los encuentra solo.
let listaMusica = null, temaActual = 0, ocultarMusicaT = null, titulosMusica = {};
async function armarListaMusica() {
  if (listaMusica) return listaMusica;
  try {   // opcional: musica.json con los nombres → [{"archivo":"musica.mp3","titulo":"Mi tema"}]
    const rj = await fetch("musica.json", { cache: "no-cache" });
    if (rj.ok) {
      const j = await rj.json();
      if (Array.isArray(j) && j.length) {
        const ok = (f) => /^[\w .\-()]+\.(mp3|m4a|ogg|wav)$/i.test(f);
        const lst = j.map((x) => String((x && x.archivo) || x)).filter(ok);
        j.forEach((x) => { if (x && x.archivo && x.titulo) titulosMusica[String(x.archivo)] = String(x.titulo).slice(0, 40); });
        if (lst.length) { listaMusica = lst; return listaMusica; }
      }
    }
  } catch (_) {}
  const candidatos = ["musica.mp3", ...Array.from({ length: 11 }, (_, i) => `musica${i + 2}.mp3`)];
  const ok = await Promise.all(candidatos.map((f) => fetch(f, { method: "HEAD" }).then((r) => r.ok, () => false)));
  listaMusica = candidatos.filter((_, i) => ok[i]);
  if (!listaMusica.length) listaMusica = ["musica.mp3"];
  return listaMusica;
}
function marcarReproduccion(sonando) {
  $("btn-musica")?.classList.toggle("reproduciendo", sonando);
  const i = $("icono-musica"); if (i) i.className = "fa-solid " + (sonando ? "fa-pause" : "fa-play");
}
function mostrarControlesMusica() {
  $("reproductor")?.classList.add("abierto");
  clearTimeout(ocultarMusicaT);
  ocultarMusicaT = setTimeout(() => $("reproductor")?.classList.remove("abierto"), 9000);
  armarListaMusica().then(pintarPanelMusica);
}
const fmtT = (x) => { x = Math.max(0, Math.floor(x || 0)); return Math.floor(x / 60) + ":" + String(x % 60).padStart(2, "0"); };
function pintarPanelMusica() {
  const l = $("mus-lista"); if (!l || !listaMusica) return;
  l.replaceChildren(); l.hidden = listaMusica.length < 2;
  listaMusica.forEach((f, i) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "mus-it" + (i === temaActual ? " on" : "");
    b.innerHTML = "<i>" + (i === temaActual ? "♪" : String(i + 1)) + "</i><span></span>"; b.lastChild.textContent = titulosMusica[f] || ("Tema " + (i + 1));
    b.addEventListener("click", () => { mostrarControlesMusica(); ponerTema(i); });
    l.appendChild(b);
  });
  const t = $("mus-titulo"); if (t) t.textContent = titulosMusica[listaMusica[temaActual]] || ("Tema " + (temaActual + 1));
  const c = $("mus-cont"); if (c) c.textContent = (temaActual + 1) + " / " + listaMusica.length;
}
(function ligarPanelMusica() {
  const a = $("musica-fondo"), p = $("mus-panel"), pos = $("mus-pos"), vol = $("mus-vol"); if (!a || !p) return;
  a.addEventListener("timeupdate", () => { if (!$("reproductor")?.classList.contains("abierto")) return; if (pos && document.activeElement !== pos) { pos.max = String(Math.floor(a.duration || 0) || 1); pos.value = String(Math.floor(a.currentTime || 0)); } const t = $("mus-t"); if (t) t.textContent = fmtT(a.currentTime) + " / " + fmtT(a.duration); });
  pos?.addEventListener("input", () => { try { a.currentTime = Number(pos.value); } catch (_) {} });
  try { const v = parseFloat(localStorage.getItem("zarela_vol")); if (v >= 0 && v <= 1) a.volume = v; if (vol) vol.value = String(a.volume); } catch (_) {}
  vol?.addEventListener("input", () => { a.volume = Number(vol.value); try { localStorage.setItem("zarela_vol", String(a.volume)); } catch (_) {} });
  const parar = () => clearTimeout(ocultarMusicaT), seguir = () => { clearTimeout(ocultarMusicaT); ocultarMusicaT = setTimeout(() => $("reproductor")?.classList.remove("abierto"), 6000); };
  p.addEventListener("pointerenter", parar); p.addEventListener("pointerdown", parar); p.addEventListener("pointerleave", seguir); p.addEventListener("change", seguir);
})();
async function ponerTema(n, reproducir = true) {
  const audio = $("musica-fondo"); if (!audio) return;
  const lista = await armarListaMusica();
  temaActual = (n + lista.length) % lista.length;
  audio.src = lista[temaActual];
  audio.loop = lista.length === 1;
  pintarPanelMusica();
  if (reproducir) {
    try { await audio.play(); marcarReproduccion(true); }
    catch (err) { console.warn("No se pudo reproducir la música:", err); marcarReproduccion(false); mostrarAviso("No se encontró el archivo de música.", "error"); }
  }
}
async function toggleMusica() {
  const audio = $("musica-fondo"); if (!audio) return;
  const disco = $("imagen-disco");
  if (disco && !disco.getAttribute("src") && disco.dataset.src) disco.src = disco.dataset.src;
  const abierto = $("reproductor")?.classList.contains("abierto");
  mostrarControlesMusica();
  if (!audio.getAttribute("src")) return ponerTema(0);
  if (audio.paused) { try { await audio.play(); marcarReproduccion(true); } catch (_) { marcarReproduccion(false); } }
  else if (abierto) { audio.pause(); marcarReproduccion(false); }   // 1.er toque con la música sonando: solo muestra los controles
}
async function cambiarTema(d) {
  mostrarControlesMusica();
  const disco = $("imagen-disco");
  if (disco && !disco.getAttribute("src") && disco.dataset.src) disco.src = disco.dataset.src;
  await ponerTema(temaActual + d);
}
$("musica-fondo")?.addEventListener("ended", () => ponerTema(temaActual + 1));
Object.assign(window, { cambiarTema });

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
  actualizarPuntoChat(0);
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

// ---- Punto rojo en el botón del chat cuando hay mensajes nuevos del soporte ----
let ultimoAdminTs = "";
function chatVisible() {
  return window.innerWidth > 800 || !!$("chat-widget")?.classList.contains("abierto");
}
function claveVisto() { return usuarioActual ? "chat_visto_" + usuarioActual.id : null; }
function marcarChatVisto() {
  const k = claveVisto();
  if (k && ultimoAdminTs) { try { localStorage.setItem(k, ultimoAdminTs); } catch (e) { /* sin storage */ } }
  actualizarPuntoChat(0);
  if (entregaDisponible && usuarioActual) { try { supabase.rpc("cliente_marcar_leidos").then(() => {}, () => {}); } catch (_) {} }
}
function actualizarPuntoChat(n) {
  const fab = $("chat-fab");
  if (!fab) return;
  let dot = fab.querySelector(".chat-dot");
  if (!n) { dot?.remove(); document.title = document.title.replace(/^\(\d+\) /, ""); return; }
  if (!dot) { dot = document.createElement("i"); dot.className = "chat-dot"; fab.appendChild(dot); }
  dot.textContent = n > 9 ? "9+" : String(n);
}
function revisarMensajesNuevos(filas) {
  const admin = filas.filter((f) => esDelAdmin(f) && f[MSG.fechaCol]);
  ultimoAdminTs = admin.length ? String(admin[admin.length - 1][MSG.fechaCol]) : "";
  const k = claveVisto();
  let visto = null;
  try { visto = k ? localStorage.getItem(k) : null; } catch (e) { visto = null; }
  if (visto === null) { marcarChatVisto(); return; }   // primera vez en este navegador: lo anterior cuenta como visto
  if (chatVisible() && !document.hidden) { marcarChatVisto(); return; }
  const nuevos = admin.filter((f) => new Date(f[MSG.fechaCol]) > new Date(visto)).length;
  actualizarPuntoChat(nuevos);
  try { avisoMensajeNuevo(nuevos, admin[admin.length - 1]); } catch (_) {}
}
window.marcarChatVisto = marcarChatVisto;

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
  revisarMensajesNuevos(filas);
  if (entregaDisponible && filas.some((f) => esDelAdmin(f) && f.entregado !== true)) { try { supabase.rpc("cliente_marcar_entregados").then(() => {}, () => {}); } catch (_) {} }
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
    if (f[MSG.archivoCol] && esAudioRuta(f[MSG.archivoCol])) {
      resolverArchivo(f[MSG.archivoCol]).then((u) => {
        const nodo = u ? nodoAudio(u, cont) : Object.assign(document.createElement("span"), { textContent: "🎤 Audio" });
        const tk = div.querySelector(":scope > .msg-tk-w"), meta = nodo.querySelector && nodo.querySelector(".wa-meta");
        if (tk && meta) { meta.appendChild(tk); div.appendChild(nodo); }   // las palomitas van abajo a la derecha del audio, junto a la duración (sin renglón extra)
        else div.insertBefore(nodo, tk || null);
      });
    } else if (f[MSG.archivoCol]) {
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

// Si soporte no está en línea (o las recargas están demoradas), el cliente recibe un aviso claro apenas manda su mensaje
function avisoSoporteAusente() {
  const c = $("chat-messages-container"); if (!c) return;
  let a = $("chat-aviso-off");
  if (soporteEstado === "en_linea") { a?.remove(); return; }
  if (!a) { a = document.createElement("div"); a.id = "chat-aviso-off"; a.className = "chat-aviso-off"; c.after(a); }
  a.textContent = "🌙 Alma Zarela está desconectada en este momento. Ya recibimos tu mensaje y te responde en breve, apenas vuelva. Si es por una recarga, quedate tranquilo/a: se acredita sola.";
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
    try { avisoSoporteAusente(); } catch (_) {}
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


// ------------------------- OPINIONES DE CLIENTES ---------------------
const OP_PASO = 6;
const OP_EMOJIS = ["👍", "🔥", "💎", "❤️"];
let opiniones = [], respuestas = [], reacciones = [];
let opLimite = OP_PASO, opPuntos = 5, opEditando = false, opEnviando = false, opCargadas = false;
const respAbiertas = new Set();

function nodoEstrellas(n) {
  const s = document.createElement("span");
  s.className = "op-estrellas"; s.setAttribute("aria-label", n + " de 5 estrellas");
  for (let i = 1; i <= 5; i++) { const b = document.createElement("b"); b.textContent = "★"; if (i <= n) b.className = "on"; s.appendChild(b); }
  return s;
}
function nombreCompleto(user) {
  const m = user.user_metadata || {};
  return String(m.full_name || m.name || (user.email || "").split("@")[0] || "Cliente").trim().slice(0, 40) || "Cliente";
}
function fotoDe(user) {
  const m = user.user_metadata || {};
  const u = m.avatar_url || m.picture || "";
  return /^https:\/\//.test(u) ? u : null;
}
function nodoAvatar(nombre, url, clase, uid) {
  const d = document.createElement("div");
  d.className = "op-avatar " + (clase || "");
  const ini = (nombre || "?")[0].toUpperCase();
  if (url && /^https:\/\//.test(url)) {
    const img = document.createElement("img");
    img.src = url; img.alt = ""; img.referrerPolicy = "no-referrer"; img.loading = "lazy";
    img.addEventListener("error", () => { img.remove(); d.textContent = ini; });
    d.appendChild(img);
  } else d.textContent = ini;
  const nv = uid ? nivelDeUsuario(uid) : -1;
  return nv >= 0 ? enmarcar(d, nv) : d;
}
function avatarDe(userId, url) {
  return perfilSoporte && perfilSoporte.user_id && userId === perfilSoporte.user_id && perfilSoporte.avatar_url ? perfilSoporte.avatar_url : url;
}
function hace(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "recién";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  if (s < 86400 * 30) { const d = Math.floor(s / 86400); return `hace ${d} ${d === 1 ? "día" : "días"}`; }
  return new Date(iso).toLocaleDateString("es-AR");
}
async function cargarOpiniones() {
  const { data, error } = await supabase.from("opiniones").select("*").order("created_at", { ascending: false }).limit(200);
  if (error) {
    console.warn("Opiniones:", error.message || error);
    const l = $("comments-list");
    if (l) l.innerHTML = '<p class="op-vacio">Pronto vas a poder ver y dejar opiniones acá.</p>';
    return;
  }
  opiniones = data || [];
  // Respuestas y reacciones: si todavía no existen las tablas, la sección funciona igual sin ellas
  const [r1, r2] = await Promise.all([
    supabase.from("opiniones_respuestas").select("*").order("created_at", { ascending: true }).limit(1000),
    supabase.from("opiniones_reacciones").select("opinion_id,user_id,emoji").limit(5000),
  ]);
  respuestas = r1.error ? [] : (r1.data || []);
  reacciones = r2.error ? [] : (r2.data || []);
  try { await cargarNivelesUsuarios(); } catch (_) {}
  try {   // v58: siempre el nombre y la foto ACTUALES (si la persona cambió su nombre, se ve el nuevo)
    await cargarPublicos([...opiniones, ...respuestas].map((x) => x.user_id), true);
    const act = (x) => { const p = perfPub[x.user_id]; if (p) { x.nombre = p.nombre; if (p.foto) x.avatar_url = p.foto; } };
    opiniones.forEach(act); respuestas.forEach(act);
  } catch (_) {}
  opCargadas = true;
  renderOpiniones();
}
function esAdminActual() { return !!usuarioActual && (usuarioActual.email || "").toLowerCase() === CONFIG.ADMIN_EMAIL.toLowerCase(); }

let opBusca = "";
let opPuede = null;   // null = todavía no se sabe (o falta el SQL): no se bloquea
function renderOpiniones() {
  const lista = $("comments-list");
  if (!lista) return;
  const mia = usuarioActual ? opiniones.find((o) => o.user_id === usuarioActual.id) : null;

  const bloq = !!usuarioActual && opPuede === false && !mia;   // solo opinan quienes ya recargaron
  $("op-form-login").hidden = !!usuarioActual;
  if ($("op-form-bloq")) $("op-form-bloq").hidden = !bloq;
  $("op-form-campos").hidden = !usuarioActual || bloq || (!!mia && !opEditando);
  if ($("op-form")) $("op-form").hidden = !!usuarioActual && !bloq && !!mia && !opEditando;
  if (usuarioActual && !$("op-pick").childElementCount) pintarSelectorEstrellas();

  const res = $("op-resumen");
  if (res) {
    res.hidden = !opiniones.length;
    if (opiniones.length) {
      const prom = opiniones.reduce((a, o) => a + o.estrellas, 0) / opiniones.length;
      $("op-prom-num").textContent = prom.toFixed(1);
      $("op-prom-est").replaceChildren(nodoEstrellas(Math.round(prom)));
      $("op-prom-total").textContent = `${opiniones.length} ${opiniones.length === 1 ? "opinión" : "opiniones"}`;
      const cont = $("op-barras"); cont.replaceChildren();
      for (let e = 5; e >= 1; e--) {
        const c = opiniones.filter((o) => o.estrellas === e).length;
        const fila = document.createElement("div"); fila.className = "op-barra";
        const i = document.createElement("i"); i.textContent = e + "★";
        const sp = document.createElement("span"); const em = document.createElement("em"); em.style.width = (c / opiniones.length * 100) + "%"; sp.appendChild(em);
        const u = document.createElement("u"); u.textContent = c;
        fila.append(i, sp, u); cont.appendChild(fila);
      }
    }
  }

  lista.replaceChildren();
  if (!opCargadas) return;
  if (!$("op-buscar")) {   // lupa: solo se ve en modo administrador
    const w = document.createElement("div"); w.className = "op-buscar-w";
    w.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i><input id="op-buscar" type="search" placeholder="Buscar una opinión (nombre o texto)…" autocomplete="off" aria-label="Buscar una opinión">';
    lista.parentNode.insertBefore(w, lista);
    w.querySelector("input").addEventListener("input", (e) => { opBusca = e.target.value.trim().toLowerCase(); renderOpiniones(); });
  }
  const enAdmin = document.body.classList.contains("modo-admin") && esAdminActual();
  const visibles = enAdmin && opBusca ? opiniones.filter((o) => (String(o.nombre || "") + " " + String(o.texto || "")).toLowerCase().includes(opBusca)) : opiniones;
  if (enAdmin && opBusca && !visibles.length) { const p = document.createElement("p"); p.className = "op-vacio"; p.textContent = "No hay opiniones que coincidan."; lista.appendChild(p); }
  if (!opiniones.length) {
    const p = document.createElement("p"); p.className = "op-vacio";
    p.textContent = "Todavía no hay opiniones. ¡Sé el primero en contar tu experiencia! 💎";
    lista.appendChild(p);
  }
  visibles.slice(0, enAdmin ? Math.max(opLimite, 30) : opLimite).forEach((o) => lista.appendChild(tarjetaOpinion(o)));
  if ($("op-mas")) $("op-mas").hidden = visibles.length <= (enAdmin ? Math.max(opLimite, 30) : opLimite);
}

function tarjetaOpinion(o) {
  const propia = !!usuarioActual && o.user_id === usuarioActual.id;
  const card = document.createElement("div");
  card.className = "op-card" + (propia ? " mia" : "");
  const cu = document.createElement("div"); cu.className = "op-cuerpo";
  const cab = document.createElement("div"); cab.className = "op-cab";
  const nom = document.createElement("b"); nom.textContent = o.nombre;
  nom.className = "pf-link"; nom.addEventListener("click", () => window.abrirPerfil && window.abrirPerfil(o.user_id));
  const t = document.createElement("time"); t.textContent = hace(o.created_at);
  cab.append(conBanner(nom, o.user_id), nodoEstrellas(o.estrellas), t);
  const tx = document.createElement("p"); tx.textContent = o.texto;
  cu.append(cab, tx);

  // Reacciones
  const rx = document.createElement("div"); rx.className = "op-reacs";
  OP_EMOJIS.forEach((em) => {
    const lista = reacciones.filter((r) => r.opinion_id === o.id && r.emoji === em);
    const mio = !!usuarioActual && lista.some((r) => r.user_id === usuarioActual.id);
    const b = document.createElement("button");
    b.type = "button"; b.className = "op-reac" + (mio ? " on" : ""); b.setAttribute("aria-pressed", String(mio));
    b.textContent = em + (lista.length ? " " + lista.length : "");
    b.addEventListener("click", () => alternarReaccion(o.id, em));
    rx.appendChild(b);
  });
  const rs = respuestas.filter((r) => r.opinion_id === o.id);
  const btnResp = document.createElement("button");
  btnResp.type = "button"; btnResp.className = "op-reac op-responder";
  btnResp.textContent = "💬 " + (rs.length ? `Respuestas (${rs.length})` : "Responder");
  btnResp.addEventListener("click", () => { respAbiertas.has(o.id) ? respAbiertas.delete(o.id) : respAbiertas.add(o.id); renderOpiniones(); });
  rx.appendChild(btnResp);
  if (propia) {
    const ed = document.createElement("button"); ed.type = "button"; ed.className = "op-link"; ed.textContent = "✏️ Editar";
    ed.addEventListener("click", () => editarOpinion(o)); rx.appendChild(ed);
  }
  if (adminVisible() && !propia) {
    const bl = document.createElement("button"); bl.type = "button"; bl.className = "op-link";
    bl.textContent = bloqueados.has(o.user_id) ? "✅ Desbloquear" : "🚫 Bloquear";
    bl.addEventListener("click", async () => { await alternarBloqueo(o.user_id, o.nombre); renderOpiniones(); }); rx.appendChild(bl);
  }
  if (propia || adminVisible()) {
    const del = document.createElement("button"); del.type = "button"; del.className = "op-link"; del.textContent = "🗑️ Eliminar";
    del.addEventListener("click", () => eliminarOpinion(o)); rx.appendChild(del);
  }
  cu.appendChild(rx);

  // Hilo de respuestas
  if (respAbiertas.has(o.id)) {
    const hilo = document.createElement("div"); hilo.className = "op-hilo";
    rs.forEach((r) => {
      const it = document.createElement("div"); it.className = "op-resp";
      const c2 = document.createElement("div"); c2.className = "op-resp-c";
      const h = document.createElement("div"); h.className = "op-cab";
      const n2 = document.createElement("b"); n2.textContent = r.nombre; h.appendChild(conBanner(n2, r.user_id));
      if (r.es_admin) { const ins = document.createElement("span"); ins.className = "op-badge"; ins.textContent = "Soporte Zarela"; h.appendChild(ins); }
      const t2 = document.createElement("time"); t2.textContent = hace(r.created_at); h.appendChild(t2);
      const p2 = document.createElement("p"); p2.textContent = r.texto;
      c2.append(h, p2);
      if (usuarioActual && (r.user_id === usuarioActual.id || adminVisible())) {
        const d2 = document.createElement("button"); d2.type = "button"; d2.className = "op-link"; d2.textContent = "🗑️ Eliminar";
        d2.addEventListener("click", () => eliminarRespuesta(r)); c2.appendChild(d2);
      }
      it.append(nodoAvatar(r.nombre, avatarDe(r.user_id, r.avatar_url), "chico", r.user_id), c2);
      hilo.appendChild(it);
    });
    const f = document.createElement("div"); f.className = "op-resp-form";
    if (usuarioActual) {
      const inp = document.createElement("input");
      inp.type = "text"; inp.maxLength = 300; inp.placeholder = esAdminActual() ? "Responder como Soporte Zarela…" : "Escribí tu respuesta…";
      const b = document.createElement("button"); b.type = "button"; b.className = "op-btn"; b.innerHTML = '<i class="fa-solid fa-paper-plane"></i>'; b.setAttribute("aria-label", "Enviar respuesta");
      const enviar = () => enviarRespuesta(o.id, inp, b);
      b.addEventListener("click", enviar);
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") enviar(); });
      f.append(inp, b);
    } else {
      const b = document.createElement("button"); b.type = "button"; b.className = "op-btn op-btn-sec";
      b.textContent = "Iniciá sesión para responder"; b.addEventListener("click", loginConGoogle); f.appendChild(b);
    }
    hilo.appendChild(f);
    cu.appendChild(hilo);
  }
  card.append(nodoAvatar(o.nombre, avatarDe(o.user_id, o.avatar_url), "", o.user_id), cu);
  return card;
}

async function alternarReaccion(opId, emoji) {
  if (!usuarioActual) return mostrarAviso("Iniciá sesión con Google para reaccionar.", "error");
  const uid = usuarioActual.id;
  const ya = reacciones.some((r) => r.opinion_id === opId && r.user_id === uid && r.emoji === emoji);
  // actualización inmediata; si falla se revierte
  if (ya) reacciones = reacciones.filter((r) => !(r.opinion_id === opId && r.user_id === uid && r.emoji === emoji));
  else reacciones.push({ opinion_id: opId, user_id: uid, emoji });
  renderOpiniones();
  const q = ya
    ? supabase.from("opiniones_reacciones").delete().match({ opinion_id: opId, user_id: uid, emoji })
    : supabase.from("opiniones_reacciones").insert({ opinion_id: opId, user_id: uid, emoji });
  const { error } = await q;
  if (error) {
    console.warn("Reacción:", error.message || error);
    if (ya) reacciones.push({ opinion_id: opId, user_id: uid, emoji });
    else reacciones = reacciones.filter((r) => !(r.opinion_id === opId && r.user_id === uid && r.emoji === emoji));
    renderOpiniones();
    mostrarAviso("No se pudo registrar tu reacción.", "error");
  }
}
async function enviarRespuesta(opId, inp, btn) {
  const texto = inp.value.trim();
  if (!texto) return;
  if (opPuede === false) return mostrarAviso("Solo pueden responder quienes ya hicieron una recarga.", "error");
  btn.disabled = true;
  const fila = { opinion_id: opId, user_id: usuarioActual.id, nombre: esAdminActual() ? "Alma Zarela" : nombreCompleto(usuarioActual), avatar_url: fotoDe(usuarioActual), es_admin: esAdminActual(), texto };
  const { data, error } = await supabase.from("opiniones_respuestas").insert(fila).select().single();
  btn.disabled = false;
  if (error) { console.warn("Respuesta:", error.message || error); return mostrarAviso("No se pudo enviar la respuesta.", "error"); }
  respuestas.push(data);
  respAbiertas.add(opId);
  renderOpiniones();
}
async function eliminarRespuesta(r) {
  if (!confirm("¿Eliminar esta respuesta?")) return;
  const { error } = await supabase.from("opiniones_respuestas").delete().eq("id", r.id);
  if (error) return mostrarAviso("No se pudo eliminar.", "error");
  respuestas = respuestas.filter((x) => x.id !== r.id);
  renderOpiniones();
}
function verMasOpiniones() { opLimite += OP_PASO; renderOpiniones(); }

function pintarSelectorEstrellas() {
  const box = $("op-pick"); box.replaceChildren();
  for (let i = 1; i <= 5; i++) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = "★"; b.setAttribute("role", "radio"); b.setAttribute("aria-label", i + " estrellas");
    b.addEventListener("click", () => { opPuntos = i; marcarEstrellas(); });
    box.appendChild(b);
  }
  marcarEstrellas();
}
function marcarEstrellas() {
  [...$("op-pick").children].forEach((b, i) => { b.classList.toggle("on", i < opPuntos); b.setAttribute("aria-checked", String(i === opPuntos - 1)); });
}
function editarOpinion(o) {
  opEditando = true; opPuntos = o.estrellas;
  $("op-texto").value = o.texto; actualizarContadorOp();
  $("op-form-tit").textContent = "Editá tu opinión";
  $("op-cancelar").hidden = false;
  renderOpiniones(); marcarEstrellas();
  $("op-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
}
function cancelarEdicionOpinion() {
  opEditando = false; $("op-texto").value = ""; opPuntos = 5; actualizarContadorOp();
  $("op-form-tit").textContent = "Dejá tu opinión"; $("op-cancelar").hidden = true;
  renderOpiniones();
}
function actualizarContadorOp() { const t = $("op-texto"); if (t && $("op-cont")) $("op-cont").textContent = t.value.length + "/300"; }

async function publicarOpinion() {
  if (opEnviando) return;
  if (!usuarioActual) return mostrarAviso("Iniciá sesión con Google para opinar.", "error");
  if (opPuede === false) return mostrarAviso("Solo pueden opinar quienes ya hicieron una recarga.", "error");
  const texto = $("op-texto").value.trim();
  if (texto.length < 5) return mostrarAviso("Escribí al menos unas palabras sobre tu experiencia.", "error");
  opEnviando = true; $("op-enviar").disabled = true;
  try {
    const fila = { user_id: usuarioActual.id, nombre: nombreCompleto(usuarioActual), estrellas: opPuntos, texto, avatar_url: fotoDe(usuarioActual) };
    let { error } = await supabase.from("opiniones").upsert(fila, { onConflict: "user_id" });
    if (error && /avatar_url/i.test(error.message || "")) {   // todavía no se corrió opiniones_v2.sql
      delete fila.avatar_url;
      ({ error } = await supabase.from("opiniones").upsert(fila, { onConflict: "user_id" }));
    }
    if (error) throw error;
    mostrarAviso("¡Gracias por tu opinión! 🔥", "ok");
    opEditando = false; $("op-texto").value = ""; $("op-form-tit").textContent = "Dejá tu opinión"; $("op-cancelar").hidden = true; actualizarContadorOp();
    await cargarOpiniones();
  } catch (err) {
    console.error("Opinión:", err);
    mostrarAviso("No se pudo publicar. Reintentá.", "error");
  } finally {
    opEnviando = false; $("op-enviar").disabled = false;
  }
}
async function eliminarOpinion(o) {
  if (!confirm("¿Eliminar esta opinión?")) return;
  const { error } = await supabase.from("opiniones").delete().eq("id", o.id);
  if (error) return mostrarAviso("No se pudo eliminar.", "error");
  opiniones = opiniones.filter((x) => x.id !== o.id);
  respuestas = respuestas.filter((x) => x.opinion_id !== o.id);
  reacciones = reacciones.filter((x) => x.opinion_id !== o.id);
  if (usuarioActual && o.user_id === usuarioActual.id) opEditando = false;
  renderOpiniones();
  mostrarAviso("Opinión eliminada.", "ok");
}
$("op-texto")?.addEventListener("input", actualizarContadorOp);
cargarOpiniones();


// ---- Lupas del panel de administrador: buscar cliente y buscar dentro de la conversación ----
const sinTildes = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
function filtrarHijos(contenedor, consulta, omitir) {
  const q = sinTildes(consulta).trim();
  let visibles = 0, total = 0;
  [...contenedor.children].forEach((el) => {
    if (omitir && omitir(el)) return;
    total++;
    const ok = !q || sinTildes(el.textContent).includes(q);
    el.style.display = ok ? "" : "none";
    if (ok) visibles++;
  });
  return { visibles, total, q };
}
function iniciarBuscadorClientes() {
  const inp = $("admin-buscar-cliente"), lista = $("admin-users-list");
  if (!inp || !lista) return;
  const aplicar = () => {
    const r = filtrarHijos(lista, inp.value, (el) => el.tagName === "P");
    const v = $("admin-buscar-vacio"); if (v) v.hidden = !(r.q && r.total && !r.visibles);
  };
  inp.addEventListener("input", aplicar);
  new MutationObserver(aplicar).observe(lista, { childList: true });
}
function agregarBuscadorConversacion(vista, msgs) {
  const caja = document.createElement("label");
  caja.className = "adm-buscar"; caja.style.marginBottom = "8px";
  const ic = document.createElement("i"); ic.className = "fa-solid fa-magnifying-glass";
  const inp = document.createElement("input");
  inp.type = "search"; inp.id = "admin-buscar-msg"; inp.placeholder = "Buscar en esta conversación…"; inp.autocomplete = "off";
  inp.setAttribute("aria-label", "Buscar en la conversación");
  const cont = document.createElement("small"); cont.style.cssText = "color:#8b93a7;white-space:nowrap;font-size:11px;";
  caja.append(ic, inp, cont);
  const aplicar = () => {
    const r = filtrarHijos(msgs, inp.value, (el) => el.tagName === "P");
    cont.textContent = r.q ? `${r.visibles} resultado${r.visibles === 1 ? "" : "s"}` : "";
  };
  inp.addEventListener("input", aplicar);
  new MutationObserver(aplicar).observe(msgs, { childList: true });
  vista.insertBefore(caja, msgs);
}
iniciarBuscadorClientes();

// ---- Foto y nombre del soporte (se guardan en la tabla perfil_soporte; se actualizan solos cuando entrás como administradora) ----
let perfilSoporte = null;
function aplicarPerfilSoporte() {
  const av = $("chat-avatar");
  if (av && perfilSoporte && /^https:\/\//.test(perfilSoporte.avatar_url || "") && !av.querySelector("img")) {
    const img = document.createElement("img");
    img.alt = ""; img.referrerPolicy = "no-referrer"; img.src = perfilSoporte.avatar_url;
    img.addEventListener("error", () => img.remove());
    av.prepend(img);
    [...av.childNodes].forEach((nd) => { if (nd.nodeType === 3) nd.remove(); });   // saca la letra
  }
  if (typeof renderOpiniones === "function" && opCargadas) renderOpiniones();
}
async function cargarPerfilSoporte() {
  const { data, error } = await supabase.from("perfil_soporte").select("user_id,nombre,avatar_url").eq("id", 1).maybeSingle();
  if (!error && data) { perfilSoporte = data; aplicarPerfilSoporte(); }
}
async function sincronizarPerfilSoporte(user) {
  const foto = fotoDe(user);
  if (!foto) return;
  if (perfilSoporte && perfilSoporte.avatar_url === foto && perfilSoporte.user_id === user.id) return;
  const { error } = await supabase.from("perfil_soporte").upsert({ id: 1, user_id: user.id, nombre: "Alma Zarela", avatar_url: foto, updated_at: new Date().toISOString() });
  if (!error) { perfilSoporte = { user_id: user.id, nombre: "Alma Zarela", avatar_url: foto }; aplicarPerfilSoporte(); }
}
cargarPerfilSoporte();

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
  const yo = usuarioActual ? usuarioActual.id : null;
  try { await supabase.auth.signOut({ scope: "local" }); } catch (err) { console.error(err); }
  try { if (yo) cuentaOlvidar(yo); } catch (_) {}
  renderSesion(null);
  try { pintarCuentas(); } catch (_) {}
}

function renderSesion(user) {
  if (!user) detenerPollAdmin();
  if (!user || (usuarioActual && usuarioActual.id !== user.id)) resetHistorialCompras();   // otra cuenta: no se arrastra el historial anterior
  usuarioActual = user;
  const logueado = !!user;
  const esAdminEmail = logueado && (user.email || "").toLowerCase() === CONFIG.ADMIN_EMAIL.toLowerCase();

  $("auth-forms").style.display = logueado ? "none" : "block";
  $("user-dashboard").style.display = logueado ? "block" : "none";
  if ($("hist-arriba")) $("hist-arriba").style.display = logueado ? "block" : "none";
  if (typeof renderOpiniones === "function") { opEditando = false; renderOpiniones(); }
  if (esAdminEmail) { setTimeout(() => sincronizarPerfilSoporte(user), 0); setTimeout(cargarBloqueados, 300); }
  $("admin-panel-section").style.display = esAdminEmail ? "block" : "none";
  document.body.classList.toggle("es-admin", esAdminEmail);
  if ($("sidebar-historial")) $("sidebar-historial").style.display = logueado ? "block" : "none";
  if (logueado) {
    $("user-email-display").textContent = user.email;
    const md0 = user.user_metadata || {};
    const nom0 = md0.full_name || md0.name || (user.email || "").split("@")[0];
    if ($("cu-nombre")) $("cu-nombre").textContent = nom0;
    const cav = $("cu-av");
    if (cav) {
      cav.replaceChildren();
      const foto = md0.avatar_url || md0.picture || "";
      if (/^https:\/\//.test(foto)) {
        const im = document.createElement("img"); im.alt = ""; im.referrerPolicy = "no-referrer"; im.src = foto;
        im.addEventListener("error", () => { im.remove(); cav.textContent = (nom0[0] || "A").toUpperCase(); });
        cav.appendChild(im);
      } else cav.textContent = (nom0[0] || "A").toUpperCase();
    }
  }

  // Sidebar: perfil, login/logout y billetera
  const area = $("sidebar-auth-btn-area");
  if (area) area.style.display = logueado ? "none" : "block";
  const sb = (id) => $(id);
  if (sb("sb-perfil")) sb("sb-perfil").hidden = !logueado;
  if (sb("sb-wallet")) sb("sb-wallet").hidden = !logueado;
  if (sb("sb-logout")) { sb("sb-logout").hidden = !logueado; sb("sb-logout").onclick = logoutGoogle; }
  if (logueado) {
    const md = user.user_metadata || {};
    const nombre = md.full_name || md.name || (user.email || "").split("@")[0];
    sb("sb-nombre").textContent = nombre;
    sb("sb-email").textContent = user.email || "";
    const av = sb("sb-avatar");
    av.replaceChildren();
    if (/^https:\/\//.test(md.avatar_url || md.picture || "")) {
      const img = document.createElement("img");
      img.alt = ""; img.referrerPolicy = "no-referrer"; img.src = md.avatar_url || md.picture;
      img.addEventListener("error", () => { img.remove(); av.textContent = (nombre[0] || "A").toUpperCase(); });
      av.appendChild(img);
    } else av.textContent = (nombre[0] || "A").toUpperCase();
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
let saldoLeidoOk = false;   // true solo si la última lectura del saldo salió bien (evita avisos falsos de "te acreditamos")
function pintarSaldo(n, moneda = "USD") {
  const k = moneda === "ARS" ? "ARS" : "USD";
  saldos[k] = Number(n) || 0;
  try { if (typeof saldoBase !== "undefined" && saldoBase) saldoBase[k] = saldos[k]; } catch (_) {}   // cambios propios (compra, conversión) no cuentan como regalo
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
  saldoLeidoOk = false;
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
    saldoLeidoOk = true;
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

let ultimoEntregado = 0;
async function cargarResumenActividad() {
  if (!resumenDisponible) return;
  if (entregaDisponible && Date.now() - ultimoEntregado > 20000) { ultimoEntregado = Date.now(); try { supabase.rpc("admin_marcar_entregados").then(() => {}, () => {}); } catch (_) {} }
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

function menuNoLeidos(ancla, get, set, extras) {
  document.querySelectorAll(".nl-menu").forEach((x) => x.remove());
  const m = document.createElement("div"); m.className = "nl-menu";
  [["Todos los chats", false], ["🔵 Solo no leídos", true]].forEach(([t, v]) => { const b = document.createElement("button"); b.type = "button"; b.textContent = t + (get() === v ? "  ✔" : ""); b.className = get() === v ? "on" : ""; b.onclick = (e) => { e.stopPropagation(); set(v); m.remove(); }; m.appendChild(b); });
  (extras || []).forEach(([t, fn]) => { const b = document.createElement("button"); b.type = "button"; b.textContent = t; b.onclick = (e) => { e.stopPropagation(); m.remove(); fn(); }; m.appendChild(b); });
  ancla.parentNode.style.position = "relative"; ancla.parentNode.appendChild(m);
  setTimeout(() => document.addEventListener("click", () => m.remove(), { once: true }), 0);
}
function pintarBotonNoLeidos() {
  const lab = document.querySelector("#admin-col-lista .adm-buscar"); if (!lab || document.getElementById("adm-nl-btn")) return;
  const w = lab.parentNode; const fila = document.createElement("div"); fila.className = "nl-fila"; w.insertBefore(fila, lab); fila.appendChild(lab);
  const b = document.createElement("button"); b.type = "button"; b.id = "adm-nl-btn"; b.className = "nl-btn"; b.setAttribute("aria-label", "Filtrar chats"); b.textContent = "⋮"; fila.appendChild(b);
  b.onclick = (e) => { e.stopPropagation(); menuNoLeidos(b, () => soloNoLeidos, (v) => { soloNoLeidos = v; b.classList.toggle("on", v); renderListaClientes(); }); };
}
function renderListaClientes() {
  try { pintarBotonNoLeidos(); } catch (_) {}
  const lista = $("admin-users-list");
  if (!lista) return;
  if (!clientesAdmin.length) return mensajeLista(lista, "Sin clientes todavía.", "#666");

  const dato = (f) => resumenAdmin.get(f[CONFIG.COL_ID]) || { ultima: 0, noLeidos: 0 };
  const filas = [...clientesAdmin].filter((f) => pasaFiltroChats(f[CONFIG.COL_ID])).sort((a, b) => {
    const d = dato(b).ultima - dato(a).ultima;   // más reciente arriba
    return d !== 0 ? d : String(a[CONFIG.COL_EMAIL] || "").localeCompare(String(b[CONFIG.COL_EMAIL] || ""));
  });

  if (!filas.length) return mensajeLista(lista, textoVacioChats(), "#8b93a7");
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
    const borde = seleccionado ? "#7fd6ff" : noLeidos ? "#3b82f6" : "#2b3544";
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
let comprasNumero = new Map();   // id de orden -> número de compra del propio cliente (1, 2, 3…)
const numCompra = (o) => comprasNumero.get(o.id) ?? o.id;
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
  try {
    let total = comprasUsuario.length;
    if (comprasHayMas) {
      const r = await conTimeout(supabase.from("ordenes_recarga").select("id", { count: "exact", head: true }).eq("user_id", uid), 8000);
      if (!r.error && Number.isFinite(r.count)) total = r.count;
    }
    comprasNumero = new Map(comprasUsuario.map((o, i) => [o.id, total - i]));
  } catch (_) { comprasNumero = new Map(); }
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
      ? filaCompra("Compra", "#" + numCompra(o))
      : filaCompra("Compra · PIN", `#${numCompra(o)} · ${o.pin_id ? "PIN asignado ✔" : "PIN sin asignar"}`));
    if (est.nota) {
      const n = document.createElement("div");
      n.className = "hist-nota";
      n.textContent = est.nota;
      item.appendChild(n);
    }
    const sh = document.createElement("button"); sh.type = "button"; sh.className = "hist-share"; sh.textContent = "🔗 Compartir estado";
    sh.addEventListener("click", () => compartirEstado(o.id, sh));
    item.appendChild(sh);
    lista.appendChild(item);
  });
}

// Abre/cierra el panel; al abrir consulta y, mientras está abierto, se actualiza solo si hay recargas en proceso
function alternarComo() {
  const b = $("como-toggle"), p = $("como-panel");
  const abrir = p.hidden;
  p.hidden = !abrir; b.setAttribute("aria-expanded", String(abrir));
}
window.alternarComo = alternarComo;
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
  setTimeout(() => $("hist-arriba")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
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
let promoAusT = null;
function promoAusSeg() { try { return Math.max(5, Math.min(600, parseInt(localStorage.getItem("zarela_promo_ausente") || "20", 10) || 20)); } catch (_) { return 20; } }
let vistaAdmin = "clientes";
let hoySeq = 0, promoModo = false, promoSeg = 90, promoSegBorrador = 90, promoCambioTs = 0, promoOcupado = false, promoUltModo = null, promoVistas = new Set();
let vistaChats = "normal";
let chatFijado = null;   // id del cliente cuyo chat queda abierto aunque cambies de sala
let filtroOrdenesInicial = true;    // la primera vez muestra "Requieren atención" solo si hay alguna
const reenviando = new Set();

const atencion = (o) => REENVIABLES.has(o.estado);
const fechaCorta = (v) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

const VISTAS_CHAT = ["clientes", "archivados", "sala1", "sala2", "sala3"];
const VISTAS_COBRO = ["cobro", "precios", "niveles"];
const TODAS_VISTAS = ["hoy", ...VISTAS_CHAT, "ordenes", "stock", "todas", "jugadores", "novedades", ...VISTAS_COBRO];
function mostrarVistaAdmin(vista) {
  try { if (vista !== vistaAdmin) sfx("tap"); } catch (_) {}
  if (!TODAS_VISTAS.includes(vista)) vista = "clientes";
  if (vista === "hoy") { clearTimeout(promoAusT); promoAusT = null; }
  else if (promoModo && !promoAusT) {   // saliste de Pendientes: seguís disponible unos segundos; si no volvés, se apaga y todo sale con PIN
    const sg = promoAusSeg();
    promoAusT = setTimeout(() => { promoAusT = null; if (vistaAdmin !== "hoy" && promoModo) promoApagarAuto(); }, sg * 1000);
    mostrarAviso(`Seguís disponible. Si no volvés a Pendientes en ${sg} s, se apaga y los pedidos salen con PIN.`, "info");
  }
  const esCobro = VISTAS_COBRO.includes(vista), esChat = VISTAS_CHAT.includes(vista);
  vistaAdmin = vista;
  vistaChats = vista === "clientes" ? "normal" : esChat ? vista : vistaChats;
  const mostrar = (id, ok) => { const e = $(id); if (e) e.hidden = !ok; };
  mostrar("admin-vista-hoy", vista === "hoy"); mostrar("admin-vista-clientes", esChat); mostrar("admin-vista-ordenes", vista === "ordenes"); mostrar("admin-vista-stock", vista === "stock");
  mostrar("admin-vista-novedades", vista === "novedades"); mostrar("admin-vista-salas", vista === "todas"); mostrar("admin-vista-jugadores", vista === "jugadores"); mostrar("admin-vista-cobro", esCobro);
  TODAS_VISTAS.forEach((v) => { const t = $("admin-tab-" + v); if (t) { t.classList.toggle("activa", v === vista); t.setAttribute("aria-selected", String(v === vista)); } });
  document.querySelectorAll("#admin-vista-cobro .cobro-sec").forEach((d) => { d.hidden = d.dataset.pane !== vista; d.open = true; });
  if (vista === "hoy") pintarHoy();
  if (vista === "ordenes") cargarOrdenesAdmin(false);
  if (vista === "stock") cargarStockPines();
  if (esCobro) rellenarCobro();
  if (esChat) {
    pintarAyudaChats();
    // al pasar de una sala a otra, el chat de un cliente que no está en la nueva sala se cierra (salvo que esté fijado 📌)
    if (clienteSel && chatFijado !== clienteSel.id && !pasaFiltroChats(clienteSel.id)) { try { cerrarChatActual(); } catch (_) {} }
    renderListaClientes();
  }
  if (vista === "todas" || vista === "jugadores") pintarTodasSalas();
  if (vista === "novedades" && window.novAdminCargar) window.novAdminCargar();
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
  const todos = String(texto || "").split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  return { total: lista.length, validos: validos.length, invalidos: lista.length - validos.length, repetidos: todos.length - lista.length };
}

function actualizarContadorStock() {
  const c = $("stock-contador"), btn = $("stock-agregar");
  if (!c) return;
  const r = pinesDetectados($("stock-texto") && $("stock-texto").value);
  c.textContent = r.total === 0 ? "0 PIN detectados" : `${r.validos} PIN válido${r.validos === 1 ? "" : "s"}` + (r.invalidos ? ` · ${r.invalidos} con formato raro` : "") + (r.repetidos ? ` · ${r.repetidos} repetido${r.repetidos === 1 ? "" : "s"} en lo que pegaste` : "");
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
  await revisarPinesStock(true);   // revisión fresca contra la base antes de confirmar
  const rv = revisionStock;
  if (rv && rv.nuevos === 0) { res.className = "stock-resultado error"; res.textContent = "Todos esos PIN ya estaban cargados: no hay nada nuevo para agregar."; return; }
  const resumen = rv ? `${rv.nuevos} nuevo${rv.nuevos === 1 ? "" : "s"}` + (rv.ya_cargados ? ` (se saltean ${rv.ya_cargados} que ya estaban cargados)` : "") : `${r.validos} PIN`;
  if (!window.confirm(`¿Agregar ${resumen} al paquete de ${etiqueta}${p ? " (" + p.diamantes + " 💎)" : ""}?`)) return;
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
    const det = $("stock-ultimos"); if (det) det.open = true;
    cargarUltimosPines(true);
    revisionStock = null; $("stock-revision") && ($("stock-revision").hidden = true);
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
// ---- Stock más fácil (v18): revisión de repetidos antes de cargar, últimos 10 subidos y buscador de PIN
let revisionStock = null, revisionT = null, revisionSeq = 0, avisoV18 = false;
const etiquetaPaq = (id) => (ETIQUETA_STOCK[id] ? ETIQUETA_STOCK[id] + " 💎" : id || "?");
function faltaV18(e) { return /PGRST202|42883|admin_(revisar_pines|ultimos_pines|buscar_pin)/i.test(String((e && (e.code + " " + e.message)) || e || "")); }
async function revisarPinesStock(ahora) {
  const area = $("stock-texto"), box = $("stock-revision"), sel = $("stock-paquete");
  if (!area || !box || !sel) return;
  const local = pinesDetectados(area.value);
  if (!local.validos) { revisionStock = null; box.hidden = true; const b0 = $("stock-agregar"); if (b0 && !guardandoStock) b0.textContent = "Agregar al stock"; return; }
  const mi = ++revisionSeq;
  try {
    const { data, error } = await conTimeout(supabase.rpc("admin_revisar_pines", { p_paquete_id: sel.value, p_pines: area.value }), 12000);
    if (error) throw error;
    if (mi !== revisionSeq) return;
    revisionStock = data;
    const partes = [];
    partes.push(`<span class="rv ok">✅ ${data.nuevos} nuevo${data.nuevos === 1 ? "" : "s"}</span>`);
    if (data.ya_cargados) partes.push(`<span class="rv mal">⚠️ ${data.ya_cargados} ya estaba${data.ya_cargados === 1 ? "" : "n"} cargado${data.ya_cargados === 1 ? "" : "s"}</span>`);
    if (data.repetidos_pegado) partes.push(`<span class="rv mal">🔁 ${data.repetidos_pegado} repetido${data.repetidos_pegado === 1 ? "" : "s"} en lo que pegaste</span>`);
    if (data.invalidos) partes.push(`<span class="rv mal">❌ ${data.invalidos} con formato raro</span>`);
    let detalle = "";
    const otros = (data.ya_ejemplos || []).filter((x) => x.paquete_id !== sel.value);
    if (otros.length) detalle += `<div class="rv-det">Ojo: ${otros.length === 1 ? "uno de ellos está" : "algunos están"} en OTRO paquete (…${esc(otros[0].fin)} → ${esc(etiquetaPaq(otros[0].paquete_id))}). ¿Elegiste bien el paquete?</div>`;
    const usados = (data.ya_ejemplos || []).filter((x) => x.usado);
    if (usados.length) detalle += `<div class="rv-det">${usados.length === 1 ? "Uno ya figura" : "Algunos ya figuran"} como USADO${usados.length === 1 ? "" : "S"} (…${esc(usados[0].fin)}): no se vuelven a cargar.</div>`;
    if (data.ya_cargados) detalle += `<div class="rv-det">Los repetidos se saltean solos: solo se cargan los nuevos.</div>`;
    box.innerHTML = partes.join(" ") + detalle; box.hidden = false;
    const btn = $("stock-agregar"); if (btn && !guardandoStock) { btn.disabled = data.nuevos === 0; btn.textContent = data.nuevos ? `Agregar ${data.nuevos} nuevo${data.nuevos === 1 ? "" : "s"}` : "Nada nuevo para agregar"; }
  } catch (e) {
    revisionStock = null; box.hidden = true;
    if (faltaV18(e) && !avisoV18) { avisoV18 = true; mostrarAviso("Para ver los PIN repetidos antes de cargar, ejecutá novedades_clientes_v18.sql en Supabase.", "info"); }
  }
}
const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function filaPin(x) {
  const d = document.createElement("div"); d.className = "pin-fila " + (x.usado ? "usado" : "libre");
  const cod = document.createElement("code"); cod.textContent = "…" + x.fin;
  const pq = document.createElement("span"); pq.className = "pf-paq"; pq.textContent = etiquetaPaq(x.paquete_id);
  const es = document.createElement("span"); es.className = "pf-est"; es.textContent = x.usado ? "Usado" + (x.orden_id ? " · orden #" + x.orden_id : "") : "Libre";
  const t = document.createElement("small"); t.textContent = x.creado ? "subido " + hace(x.creado) : "";
  d.append(cod, pq, es, t); return d;
}
async function cargarUltimosPines(forzar) {
  const lista = $("stock-ultimos-lista"); if (!lista) return;
  if (!forzar && lista.dataset.listo === "1") return;
  try {
    const { data, error } = await conTimeout(supabase.rpc("admin_ultimos_pines", { p_limite: 10 }), 12000);
    if (error) throw error;
    lista.replaceChildren();
    if (!data || !data.length) lista.appendChild(Object.assign(document.createElement("p"), { className: "stock-vacio", textContent: "Todavía no subiste ningún PIN." }));
    (data || []).slice(0, 10).forEach((x) => lista.appendChild(filaPin(x)));
    lista.dataset.listo = "1";
  } catch (e) {
    lista.replaceChildren(Object.assign(document.createElement("p"), { className: "stock-vacio", textContent: faltaV18(e) ? "Falta ejecutar novedades_clientes_v18.sql en Supabase." : "No se pudo cargar. Probá de nuevo." }));
  }
}
let buscarPinT = null;
async function buscarPinStock() {
  const q = ($("stock-buscar-in")?.value || "").trim(), res = $("stock-buscar-res"); if (!res) return;
  if (q.length < 4) { res.replaceChildren(); return; }
  try {
    const { data, error } = await conTimeout(supabase.rpc("admin_buscar_pin", { p_texto: q }), 12000);
    if (error) throw error;
    res.replaceChildren();
    if (!data || !data.length) res.appendChild(Object.assign(document.createElement("p"), { className: "stock-vacio", textContent: "✅ Ese PIN NO está cargado (se puede agregar)." }));
    (data || []).forEach((x) => res.appendChild(filaPin(x)));
  } catch (e) { res.replaceChildren(Object.assign(document.createElement("p"), { className: "stock-vacio", textContent: faltaV18(e) ? "Falta ejecutar novedades_clientes_v18.sql en Supabase." : "No se pudo buscar." })); }
}
document.addEventListener("input", (ev) => {
  const id = ev.target && ev.target.id;
  if (id === "stock-texto") { clearTimeout(revisionT); revisionT = setTimeout(() => revisarPinesStock(), 500); }
  if (id === "stock-buscar-in") { clearTimeout(buscarPinT); buscarPinT = setTimeout(buscarPinStock, 400); }
});
document.addEventListener("change", (ev) => { if (ev.target && ev.target.id === "stock-paquete") revisarPinesStock(); });
document.addEventListener("toggle", (ev) => { if (ev.target && ev.target.id === "stock-ultimos" && ev.target.open) cargarUltimosPines(); }, true);


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

    // Orden "pendiente" hace rato y n8n nunca avisó el resultado: se dice claro qué pasa y qué hacer (sin reenviar a ciegas)
    if (o.estado === "pendiente" && o.n8n_http_status && o.created_at) {
      const min = Math.floor((Date.now() - new Date(o.updated_at || o.created_at).getTime()) / 60000);
      if (min >= 4) {
        const av = document.createElement("div");
        av.className = "ord-aviso";
        av.textContent = `⏳ Hace ${min < 120 ? min + " min" : Math.floor(min / 60) + " h"} que n8n recibió la orden y todavía no avisó el resultado. Antes de reenviar: mirá en n8n → Ejecuciones qué pasó y en redeempins.com si el PIN ya se usó. Si el PIN sigue sin usar, reenviá; si se usó, la recarga ya salió.`;
        card.appendChild(av);
      }
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
      const ac = document.createElement("button");
      ac.type = "button";
      ac.className = "ord-btn ok";
      ac.textContent = "✅ Ya se acreditó";
      ac.title = "Usalo solo si en redeempins.com comprobaste que el PIN SÍ se usó";
      ac.addEventListener("click", () => acreditarOrdenManual(o, ac));
      acciones.appendChild(ac);
      const c = document.createElement("button");
      c.type = "button";
      c.className = "ord-btn peligro";
      c.textContent = "✖ Cancelar y devolver";
      c.addEventListener("click", () => cancelarOrden(o, c));
      acciones.appendChild(c);
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

async function acreditarOrdenManual(o, boton) {
  const ok = await mostrarConfirmacion({
    tono: "ok", icono: "✅", titulo: `Cerrar orden #${o.id} como acreditada`,
    texto: "Usalo SOLO si ya comprobaste en redeempins.com que este PIN figura como usado (o el cliente ya vio sus diamantes). La orden pasa a «completada» y no se devuelve el saldo.",
    filas: [
      ["Cliente", etiquetaCliente(o.user_id) || "-"],
      ["ID Free Fire", String(o.id_jugador || "-")],
      ["Paquete", o.diamantes ? o.diamantes + " 💎" : String(o.paquete_id)],
    ],
    confirmar: "Sí, ya se acreditó", cancelar: "No, volver",
  });
  if (!ok) return;
  if (boton) { boton.disabled = true; boton.textContent = "Cerrando…"; }
  try {
    const { error } = await conTimeout(supabase.rpc("admin_acreditar_orden", { p_orden_id: o.id }), 25000);
    if (error) throw error;
    ultimaCargaOrdenes = 0;
    await cargarOrdenesAdmin(true);
    mostrarAviso(`Orden #${o.id} cerrada como acreditada.`, "ok");
    saludRevisar();
  } catch (err) {
    const msg = String((err && err.message) || "");
    mostrarAviso(
      err && err.code === "PGRST202" ? "Falta ejecutar novedades_clientes_v17.sql en Supabase."
      : msg.includes("ORDEN_CERRADA") ? "Esa orden ya estaba cerrada: actualizá la lista."
      : "No se pudo cerrar la orden. Probá de nuevo en un momento.", "error");
    renderOrdenesAdmin();
  }
}

async function cancelarOrden(o, boton) {
  const ok = await mostrarConfirmacion({
    tono: "warn", icono: "✖", titulo: `Cancelar orden #${o.id}`,
    texto: "Se le devuelve el saldo al cliente y el PIN vuelve a tu stock. Hacelo solo si estás seguro de que los diamantes NO se acreditaron (revisá el ID en Free Fire o el estado del PIN): si ya se cargaron, el cliente quedaría con diamantes y saldo.",
    filas: [
      ["Cliente", etiquetaCliente(o.user_id) || "-"],
      ["ID Free Fire", String(o.id_jugador || "-")],
      ["Paquete", o.diamantes ? o.diamantes + " 💎" : String(o.paquete_id)],
      ["Se le devuelve", montoOrden(o)],
    ],
    confirmar: "Sí, cancelar y devolver", cancelar: "No, volver",
  });
  if (!ok) return;
  if (boton) { boton.disabled = true; boton.textContent = "Cancelando…"; }
  try {
    const { data, error } = await conTimeout(supabase.rpc("admin_cancelar_orden", { p_orden_id: o.id, p_devolver_pin: true }), 25000);
    if (error) throw error;
    ultimaCargaOrdenes = 0;
    await cargarOrdenesAdmin(true);
    if (data && data.sin_cambios) mostrarAviso(`La orden #${o.id} ya estaba cerrada.`, "info");
    else mostrarAviso(`Orden #${o.id} cancelada: saldo devuelto al cliente y PIN de vuelta en el stock.`, "ok");
    if (typeof cargarStockPines === "function") cargarStockPines();
  } catch (err) {
    console.warn("No se pudo cancelar la orden:", err.message || err);
    const msg = String((err && err.message) || "");
    mostrarAviso(
      err && err.code === "PGRST202" ? "Falta ejecutar cancelar_orden.sql en Supabase."
      : msg.includes("ORDEN_CERRADA") ? "Esa orden ya estaba cerrada: actualizá la lista."
      : err && err.name === "TimeoutError" ? "Tardó demasiado. Actualizá la lista para ver cómo quedó antes de reintentar."
      : "No se pudo cancelar la orden. Probá de nuevo en un momento.", "error");
    renderOrdenesAdmin();
  }
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
  if (chatFijado && chatFijado !== fila[CONFIG.COL_ID]) chatFijado = null;   // al abrir otro chat se suelta el anterior
  respuestaPendiente.admin = null;
  abrirChatMovilAdmin();
  renderListaClientes();   // resalta el cliente elegido
  firmaMsgs = "";
  construirVistaCliente();
  refrescarMensajes(true);
  clearInterval(pollAdmin);
  pollAdmin = setInterval(() => { if (!document.hidden) refrescarMensajes(false); }, 8000);
  // si el chat está guardado como burbuja, al elegir un cliente se abre en el centro de la pantalla
  try { const fw = $("adm-flota"); if (chatFlota && fw && fw.classList.contains("min")) { fw.classList.remove("min"); if (!esMovil()) flotaCentrar(fw); flotaMargen(); } } catch (_) {}
}

// ---- Celular: el chat del cliente se abre a pantalla completa (como WhatsApp) y "atrás" vuelve a la lista ----
const esMovil = () => window.matchMedia("(max-width: 800px)").matches;
// ---- Chat flotante (burbuja): se puede trabajar en Pendientes u otra pantalla con el chat del cliente a un costado ----
let chatFlota = false, flotaMarca = null;
function flotaPos(w) { try { const r = w.getBoundingClientRect(); localStorage.setItem("zarela_flota", JSON.stringify({ l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) })); } catch (_) {} }
function flotaAjustar(w) {
  // que nunca quede fuera de la pantalla
  const r = w.getBoundingClientRect(); const mw = innerWidth, mh = innerHeight;
  let l = Math.min(Math.max(0, r.left), Math.max(0, mw - r.width)), t = Math.min(Math.max(0, r.top), Math.max(0, mh - r.height));
  w.style.left = l + "px"; w.style.top = t + "px"; w.style.right = "auto"; w.style.bottom = "auto";
}
function flotaCentrar(w) {
  const r = w.getBoundingClientRect(); const ww = parseFloat(w.style.width) || 380, hh = parseFloat(w.style.height) || 520;
  w.style.left = Math.max(0, (innerWidth - ww) / 2) + "px"; w.style.top = Math.max(0, (innerHeight - hh) / 2) + "px"; w.style.right = "auto"; w.style.bottom = "auto";
  flotaAjustar(w); flotaPos(w);
}
function flotaMargen() {
  const w = $("adm-flota"); const pc = matchMedia("(min-width: 801px)").matches;
  const ocupa = w && pc && !w.classList.contains("min");
  document.body.classList.toggle("adm-flota-lado", !!ocupa);
  if (ocupa) { const r = w.getBoundingClientRect(); document.documentElement.style.setProperty("--flw", Math.round(Math.max(0, innerWidth - r.left) + 8) + "px"); }
}
function flotaSacar() {
  const v = $("admin-chat-view"); if (!v || chatFlota) return;
  if (!clienteSel) { mostrarAviso("Primero abrí el chat de un cliente.", "info"); return; }
  try { if ($("admin-vista-clientes")?.classList.contains("adm-chat-abierto")) { $("admin-vista-clientes").classList.remove("adm-chat-abierto"); document.body.classList.remove("adm-chat-on"); } } catch (_) {}
  flotaMarca = document.createComment("chat-flotante"); v.parentNode.insertBefore(flotaMarca, v);
  const w = document.createElement("div"); w.id = "adm-flota";
  const bar = document.createElement("div"); bar.className = "flota-bar"; bar.title = "Arrastrá para mover";
  const t = document.createElement("b"); t.className = "flota-t"; t.textContent = "💬 " + (clienteSel.etiqueta || "Chat");
  const mn = document.createElement("button"); mn.type = "button"; mn.textContent = "—"; mn.title = "Guardar como burbuja"; mn.setAttribute("aria-label", "Hacer burbuja");
  const x = document.createElement("button"); x.type = "button"; x.textContent = "✕"; x.title = "Devolver el chat a su lugar"; x.className = "flota-x"; x.setAttribute("aria-label", "Devolver el chat");
  const burb = document.createElement("button"); burb.type = "button"; burb.className = "flota-burb"; burb.textContent = "💬"; burb.title = "Abrir el chat";
  const asa = document.createElement("i"); asa.className = "flota-asa"; asa.title = "Arrastrá para cambiar el tamaño";
  const minimizar = (m) => { w.classList.toggle("min", m); flotaMargen(); };
  mn.onclick = (e) => { e.stopPropagation(); minimizar(true); }; x.onclick = (e) => { e.stopPropagation(); flotaDevolver(); };
  bar.append(t, mn, x); w.append(bar, v, burb, asa); document.body.appendChild(w);
  // posición y tamaño guardados
  let g = null; try { g = JSON.parse(localStorage.getItem("zarela_flota") || "null"); } catch (_) {}
  const mov = matchMedia("(max-width: 800px)").matches;
  if (!mov) { w.style.width = Math.min(Math.max((g && g.w) || 380, 300), innerWidth - 20) + "px"; w.style.height = Math.min(Math.max((g && g.h) || 520, 320), innerHeight - 20) + "px"; w.style.left = ((g ? g.l : innerWidth - 400)) + "px"; w.style.top = ((g ? g.t : Math.max(70, innerHeight - 540))) + "px"; w.style.right = "auto"; w.style.bottom = "auto"; flotaAjustar(w); }
  // arrastrar (barra o burbuja)
  let dx = 0, dy = 0, drag = null, movio = false;
  const ini = (e) => { if (e.target.closest("button") && !e.target.classList.contains("flota-burb")) return; const r = w.getBoundingClientRect(); drag = { x: e.clientX, y: e.clientY, l: r.left, t: r.top }; movio = false; try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {} };
  const mueve = (e) => { if (!drag) return; const ddx = e.clientX - drag.x, ddy = e.clientY - drag.y; if (Math.abs(ddx) + Math.abs(ddy) > 4) movio = true; if (!movio) return; w.style.left = (drag.l + ddx) + "px"; w.style.top = (drag.t + ddy) + "px"; w.style.right = "auto"; w.style.bottom = "auto"; };
  const fin = () => { if (!drag) return; drag = null; flotaAjustar(w); flotaPos(w); flotaMargen(); };
  [bar, burb].forEach((n) => { n.addEventListener("pointerdown", ini); n.addEventListener("pointermove", mueve); n.addEventListener("pointerup", fin); n.addEventListener("pointercancel", fin); });
  burb.addEventListener("click", () => { if (!movio) { minimizar(false); if (!matchMedia("(max-width: 800px)").matches) flotaCentrar(w); flotaMargen(); } });
  // cambiar tamaño (esquina de abajo a la derecha)
  let rs = null;
  asa.addEventListener("pointerdown", (e) => { const r = w.getBoundingClientRect(); rs = { x: e.clientX, y: e.clientY, w: r.width, h: r.height }; try { asa.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); });
  asa.addEventListener("pointermove", (e) => { if (!rs) return; w.style.width = Math.min(Math.max(300, rs.w + e.clientX - rs.x), innerWidth - 10) + "px"; w.style.height = Math.min(Math.max(320, rs.h + e.clientY - rs.y), innerHeight - 10) + "px"; });
  asa.addEventListener("pointerup", () => { rs = null; flotaAjustar(w); flotaPos(w); flotaMargen(); });
  document.body.appendChild(w); document.body.classList.add("adm-flotando"); chatFlota = true; flotaMargen();
  w._i = setInterval(() => { const n = clienteSel && clienteSel.etiqueta; if (n) t.textContent = "💬 " + n; }, 1500);
  w._r = () => { flotaAjustar(w); flotaMargen(); }; window.addEventListener("resize", w._r);
}
function flotaDevolver() {
  const w = $("adm-flota"), v = $("admin-chat-view"); if (!w) { chatFlota = false; return; }
  clearInterval(w._i); window.removeEventListener("resize", w._r);
  if (flotaMarca && flotaMarca.parentNode && v) { flotaMarca.parentNode.insertBefore(v, flotaMarca); flotaMarca.remove(); }
  w.remove(); chatFlota = false; flotaMarca = null; document.body.classList.remove("adm-flotando", "adm-flota-lado");
  try { renderListaClientes(); if (vistaAdmin !== "clientes") mostrarVistaAdmin("clientes"); } catch (_) {}
}
function abrirChatMovilAdmin() {
  if (!esMovil() || chatFlota) return;
  const v = $("admin-vista-clientes");
  if (!v || v.classList.contains("adm-chat-abierto")) return;
  v.classList.add("adm-chat-abierto");
  document.body.classList.add("adm-chat-on");
  try { history.pushState({ admChat: 1 }, ""); } catch (e) {}
}
function cerrarChatAdmin(desdePop) {
  const v = $("admin-vista-clientes");
  if (!v || !v.classList.contains("adm-chat-abierto")) return;
  v.classList.remove("adm-chat-abierto");
  document.body.classList.remove("adm-chat-on");
  clearInterval(pollAdmin);
  clienteSel = null;
  renderListaClientes();
  if (!desdePop && history.state && history.state.admChat) { try { history.back(); } catch (e) {} }
}
window.addEventListener("popstate", () => cerrarChatAdmin(true));
window.addEventListener("resize", () => { if (!esMovil()) cerrarChatAdmin(false); });

function construirVistaCliente() {
  const vista = $("admin-chat-view");
  vista.replaceChildren();
  vista.style.justifyContent = "flex-start";

  const cab = document.createElement("div");
  cab.className = "adm-cab";
  cab.style.cssText = "font-size:13px;color:#ddd;margin-bottom:10px;word-break:break-all;";
  const atras = document.createElement("button");
  atras.type = "button"; atras.className = "adm-atras";
  atras.setAttribute("aria-label", "Volver a la lista de chats");
  atras.innerHTML = '<i class="fa-solid fa-arrow-left"></i> Chats';
  atras.addEventListener("click", () => cerrarChatAdmin(false));
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
  const btnBloq = creaBoton("", "margin-top:6px;margin-left:6px;padding:6px 10px;font-size:12px;");
  const pintarBloq = () => {
    const b = bloqueados.has(clienteSel.id);
    btnBloq.textContent = b ? "✅ Desbloquear" : "🚫 Bloquear";
    btnBloq.style.background = b ? "#12351f" : "#3a1717"; btnBloq.style.color = b ? "#7dffb0" : "#ff9c9c"; btnBloq.style.border = b ? "1px solid #2e7d4f" : "1px solid #7d2e2e";
  };
  pintarBloq();
  btnBloq.addEventListener("click", async () => { await alternarBloqueo(clienteSel.id, clienteSel.etiqueta); pintarBloq(); });
  cab.append(atras, nombre, sub, verOrdenes, btnBloq);
  vista.appendChild(cab);
  agregarMovimientos(vista, clienteSel.id);

  // --- Saldos (USD y ARS, independientes) ---
  if (clienteSel.saldos) {
    const caja = document.createElement("div");
    caja.style.cssText = "background:#161822;border:1px solid #2b3544;border-radius:10px;padding:10px;margin-bottom:10px;";

    const tiles = document.createElement("div");
    tiles.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;";
    [["ARS", "Saldo ARS (pesos)", "#38bdf8"], ["USD", "Saldo USD (dólares)", "#2ecc71"]].forEach(([m, titulo, color]) => {
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
    [["ARS", "ARS (pesos)"], ["USD", "USD (dólares)"]].forEach(([v, t]) => {
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
    monto.id = "admin-monto"; monto.type = "number"; monto.step = "0.01"; monto.placeholder = "Monto ARS";
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
        if (t) t.style.borderColor = x === m ? "#7fd6ff" : "#2b3544";
      });
    };
    moneda.addEventListener("change", resaltar);
    // controles claros: pesos/dólares, qué hacer, y montos rápidos
    const grupo = (opciones, alElegir, inicial) => {
      const g = document.createElement("div"); g.className = "sc-seg";
      opciones.forEach(([v, t]) => { const b = document.createElement("button"); b.type = "button"; b.textContent = t; b.dataset.v = v; b.addEventListener("click", () => { [...g.children].forEach((x) => x.classList.toggle("on", x === b)); alElegir(v); }); if (v === inicial) b.classList.add("on"); g.appendChild(b); });
      return g;
    };
    const rapidos = document.createElement("div"); rapidos.className = "sc-rap";
    const pintarRapidos = () => {
      rapidos.replaceChildren();
      (moneda.value === "ARS" ? [1000, 2000, 5000, 10000, 20000] : [1, 2, 5, 10, 20]).forEach((n) => { const b = document.createElement("button"); b.type = "button"; b.textContent = n.toLocaleString("es-AR"); b.addEventListener("click", () => { monto.value = n; monto.focus(); }); rapidos.appendChild(b); });
    };
    const gMon = grupo([["ARS", "🇦🇷 Pesos"], ["USD", "💵 Dólares"]], (v) => { moneda.value = v; resaltar(); pintarRapidos(); }, "ARS");
    const gAcc = grupo([["sumar", "➕ Sumar"], ["restar", "➖ Restar"], ["establecer", "🎯 Fijar total"]], (v) => { modo.dataset.restar = v === "restar" ? "1" : ""; modo.value = v === "establecer" ? "establecer" : "sumar"; ok.textContent = v === "restar" ? "Descontar saldo" : v === "establecer" ? "Fijar saldo total" : "Acreditar saldo"; }, "sumar");
    moneda.style.display = "none"; modo.style.display = "none";
    monto.style.width = "130px"; ok.textContent = "Acreditar saldo";
    const fSeg = document.createElement("div"); fSeg.className = "sc-fila"; fSeg.append(gMon, gAcc);
    const fMonto = document.createElement("div"); fMonto.className = "sc-fila"; fMonto.append(monto, nota, ok);
    fila.replaceChildren(moneda, modo, fSeg, rapidos, fMonto);
    pintarRapidos();
    caja.append(tiles, fila);
    caja.hidden = true;
    caja.id = "admin-caja-saldo";
    const tog = document.createElement("button");
    tog.type = "button";
    tog.setAttribute("aria-expanded", "false");
    tog.setAttribute("aria-controls", "admin-caja-saldo");
    tog.style.cssText = "width:100%;display:flex;align-items:center;gap:8px;padding:10px 12px;margin-bottom:10px;border-radius:10px;cursor:pointer;background:#161822;color:#e6ebf0;border:1px solid #2b3544;font-weight:800;font-size:13px;text-align:left;";
    const txt = document.createElement("span");
    txt.style.cssText = "flex:1;min-width:0;";
    const flecha = document.createElement("i");
    flecha.className = "fa-solid fa-chevron-down";
    flecha.style.cssText = "font-size:12px;transition:transform .2s;";
    tog.append(txt, flecha);
    const resumen = () => {
      const u = $("admin-saldo-USD")?.textContent || "", a = $("admin-saldo-ARS")?.textContent || "";
      txt.textContent = `💰 Saldos y acreditar · ${a} · ${u}`;
    };
    tog.addEventListener("click", () => {
      const abrir = caja.hidden;
      caja.hidden = !abrir;
      tog.setAttribute("aria-expanded", String(abrir));
      flecha.style.transform = abrir ? "rotate(180deg)" : "";
      tog.style.borderColor = abrir ? "#7fd6ff" : "#2b3544";
    });
    vista.append(tog, caja);
    resaltar();
    resumen();
    new MutationObserver(resumen).observe(tiles, { childList: true, subtree: true, characterData: true });
  }

  // --- Conversación ---
  const msgs = document.createElement("div");
  msgs.id = "admin-msgs";
  msgs.className = "adm-msgs";
  msgs.style.cssText = "background:#0b0c12;border-radius:8px;padding:8px;height:min(52vh,460px);min-height:240px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;margin-bottom:8px;";
  const cargando = document.createElement("p");
  cargando.style.cssText = "font-size:12px;color:#666;margin:auto;";
  cargando.textContent = "Cargando mensajes…";
  msgs.appendChild(cargando);
  vista.appendChild(msgs);
  agregarBuscadorConversacion(vista, msgs);

  // --- Responder ---
  const resp = document.createElement("div");
  resp.className = "adm-resp";
  resp.style.cssText = "display:flex;gap:6px;";
  const inp = document.createElement("input");
  inp.id = "admin-respuesta"; inp.type = "text"; inp.placeholder = "Responder al cliente… (escribí / para tus respuestas rápidas)"; inp.maxLength = 1000;
  inp.style.cssText = ESTILO_INPUT + "flex:1;";
  const env = creaBoton("Enviar", "background:linear-gradient(135deg,#2f6bff,#1b3fa8);color:#fff;border:1px solid rgba(127,214,255,.55);");
  env.id = "admin-btn-responder";
  const enviar = () => responderCliente();
  env.addEventListener("click", enviar);
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") enviar(); });
  resp.append(rrBoton(inp), inp, env);
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
      (mio ? "align-self:flex-end;background:linear-gradient(135deg,#1f4fd0,#15338f);border:1px solid rgba(127,214,255,.4);box-shadow:0 2px 10px rgba(20,60,180,.35);" : "align-self:flex-start;background:#1f2937;");

    const texto = f[MSG.textoCol];
    if (texto) {
      const t = document.createElement("div");
      t.textContent = String(texto);
      burbuja.appendChild(t);
    }

    const archivo = f[MSG.archivoCol];
    if (archivo) {
      const conectar = (u) => {
        const pie = () => burbuja.querySelector(":scope > [data-hora], :scope > .msg-tk-w");   // hora y palomitas: siempre quedan al final
        if (esAudioRuta(archivo)) {
          const n = nodoAudio(u, cont), h = pie(), m = n.querySelector(".wa-meta");
          if (h && m) { h.style.margin = "0"; m.appendChild(h); burbuja.appendChild(n); } else burbuja.insertBefore(n, h || null);
          return;
        }
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
        burbuja.insertBefore(img, pie() || null);
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
  let monto = Math.round(parseFloat($("admin-monto").value) * 100) / 100;
  if ($("admin-modo").dataset.restar === "1" && Number.isFinite(monto)) monto = -Math.abs(monto);
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
    if (monto > 0 && modo === "sumar") {   // aviso automático dentro del chat del cliente (le suena al instante)
      const txtMsg = `💰 ¡Te acreditamos saldo! +${formatoMoneda(moneda, monto)} ${moneda}. Ya podés usarlo para recargar tus diamantes. 💎`;
      supabase.from(MSG.tabla).insert({ [MSG.userCol]: sel.id, [MSG.senderCol]: usuarioActual.id, [MSG.textoCol]: txtMsg, [MSG.leidoCol]: false })
        .then(({ error: e2 }) => { if (!e2 && clienteSel === sel) refrescarMensajes(true); }, () => {});
    }
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

let entregaDisponible = true;   // false si falta ejecutar novedades_clientes_v12.sql (tildes de entregado)
let extrasDisponibles = true;   // false si falta ejecutar mensajes_extras.sql
const respuestaPendiente = { admin: null, cliente: null };
let menuAbierto = null;

async function consultarMensajes(userId) {
  const base = ["id", MSG.userCol, MSG.senderCol, MSG.textoCol, MSG.archivoCol, MSG.leidoCol, MSG.fechaCol];
  for (let intento = 0; intento < 3; intento++) {
    const cols = [...(extrasDisponibles ? [...base, ...COLS_EXTRA] : base), ...(entregaDisponible ? ["entregado"] : [])];
    const r = await supabase
      .from(MSG.tabla)
      .select(cols.join(", "))
      .eq(MSG.userCol, userId)
      .order(MSG.fechaCol, { ascending: false })
      .limit(200);
    if (r.error && entregaDisponible && columnaNoExiste(r.error) && /entregado/.test(String(r.error.message || r.error.details || ""))) { entregaDisponible = false; continue; }
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
  filas.map((f) => f.id + (f.is_read ? "r" : f.entregado ? "e" : "") + (f.pinned_at ? "p" : "") + (f.reactions ? JSON.stringify(f.reactions) : "")).join(",");

const previewDe = (f) => String(f[MSG.textoCol] || (f[MSG.archivoCol] ? (esAudioRuta(f[MSG.archivoCol]) ? "🎤 Audio" : "📎 Comprobante") : "")).slice(0, 140);

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
    .msg-chev{position:absolute;top:-8px;right:-6px;width:18px;height:18px;padding:0;border:none;border-radius:50%;
      background:rgba(13,14,21,.88);color:var(--zacc,#f3ba2f);font-size:11px;line-height:18px;cursor:pointer;opacity:0;box-shadow:0 0 0 1px #3a3f58;transition:opacity .15s;z-index:1}
    .msg-ctx:hover .msg-chev,.msg-chev:focus-visible,.msg-ctx.msg-abierto .msg-chev{opacity:1}
    @media (hover:none){.msg-chev{display:none}}
    .msg-ctx.msg-abierto{outline:1px solid var(--zacc,#f3ba2f)}
    .msg-pin{font-size:10px;color:var(--zacc,#f3ba2f);margin-bottom:2px;font-weight:700}
    .msg-quote{border-left:3px solid var(--zacc,#f3ba2f);background:rgba(0,0,0,.28);border-radius:4px;padding:3px 7px;margin-bottom:4px;
      font-size:11px;color:#cbd5e1;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .msg-quote b{display:block;color:var(--zacc,#f3ba2f);font-size:10px}
    .msg-reacts{display:flex;flex-wrap:wrap;gap:3px;margin-top:4px}
    .msg-react{background:rgba(0,0,0,.35);border:1px solid #2b3544;border-radius:10px;padding:0 6px;font-size:11px;color:#fff;cursor:pointer}
    .msg-react.mia{border-color:var(--zacc,#f3ba2f);background:var(--zacc-bg,rgba(243,186,47,.2))}
    .msg-flash{animation:msgflash 1.4s ease}
    @keyframes msgflash{0%,60%{box-shadow:0 0 0 2px var(--zacc,#f3ba2f)}100%{box-shadow:0 0 0 0 transparent}}
    #menu-mensaje{position:fixed;z-index:10001;width:max-content;min-width:236px;max-width:calc(100vw - 16px);background:#161822;
      border:1px solid var(--zacc,#f3ba2f);border-radius:14px;box-shadow:0 10px 32px rgba(0,0,0,.75);padding:8px;font-size:13px;color:#fff}
    #menu-mensaje .mm-emojis{display:flex;justify-content:space-between;gap:2px;padding:2px 0 8px;margin-bottom:6px;border-bottom:1px solid #2b3544}
    #menu-mensaje .mm-emoji{background:none;border:none;font-size:22px;line-height:1;cursor:pointer;border-radius:8px;padding:5px 6px}
    #menu-mensaje .mm-acciones{display:flex;gap:4px}
    #menu-mensaje .mm-item{flex:1 1 0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;text-align:center;
      background:rgba(255,255,255,.04);border:none;color:#fff;padding:8px 6px;border-radius:9px;cursor:pointer;font-size:11.5px;font-weight:600}
    #menu-mensaje .mm-ico{font-size:18px;line-height:1}
    #menu-mensaje .mm-item:hover,#menu-mensaje .mm-item:focus-visible,#menu-mensaje .mm-emoji:hover,#menu-mensaje .mm-emoji:focus-visible{
      background:var(--zacc-bg,rgba(243,186,47,.22));color:var(--zacc,#f3ba2f);outline:none}
    #menu-mensaje .mm-nota{font-size:11px;color:#888;padding:6px 9px 2px}
    #menu-mensaje.mm-hoja{width:auto;min-width:0;max-width:none;border-radius:16px 16px 12px 12px;padding:10px}
    #menu-mensaje.mm-hoja .mm-emoji{font-size:26px;padding:6px 8px}
    #menu-mensaje.mm-hoja .mm-item{padding:11px 6px;font-size:12px}
    .barra-msg{display:none;align-items:center;gap:8px;background:#161822;border:1px solid #2b3544;border-left:3px solid var(--zacc,#f3ba2f);
      border-radius:6px;padding:4px 8px;margin-bottom:6px;font-size:11px;color:#cbd5e1}
    .barra-msg .bm-texto{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .barra-msg b{color:var(--zacc,#f3ba2f)}
    .barra-msg button{background:none;border:none;color:var(--zacc,#f3ba2f);cursor:pointer;font-size:14px;padding:0 2px}
    .barra-fijados{flex-direction:column;align-items:stretch;gap:3px}
    .barra-fijados .fijado{cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #admin-users-list,#admin-msgs,.chat-messages-area{scrollbar-width:thin;scrollbar-color:var(--zacc,#f3ba2f) #0e0f16}
    #admin-users-list::-webkit-scrollbar,#admin-msgs::-webkit-scrollbar{width:8px}
    #admin-users-list::-webkit-scrollbar-thumb,#admin-msgs::-webkit-scrollbar-thumb{background:var(--zacc,#f3ba2f);border-radius:4px}
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
    fila.className = "msg-reacts"; burbuja.classList.add("con-react");
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

  // Tildes estilo WhatsApp en los mensajes propios: ✓ enviado, ✓✓ entregado, ✓✓ azul visto
  if (ctx === "admin" ? esDelAdmin(f) : !esDelAdmin(f)) {
    const est = f[MSG.leidoCol] === true ? "visto" : (f.entregado === true ? "entregado" : "enviado");
    const tk = document.createElement("span"); tk.className = "msg-tk " + est; tk.textContent = est === "enviado" ? "✓" : "✓✓"; tk.title = est[0].toUpperCase() + est.slice(1);
    const hora = burbuja.querySelector("[data-hora]");
    if (hora) { tk.classList.add("en-hora"); hora.appendChild(tk); } else { const w = document.createElement("div"); w.className = "msg-tk-w"; w.appendChild(tk); burbuja.appendChild(w); }
  }

  const chev = document.createElement("button");
  chev.type = "button";
  chev.className = "msg-chev";
  chev.textContent = "▾";
  chev.setAttribute("aria-label", "Opciones del mensaje");
  chev.setAttribute("aria-haspopup", "menu");
  chev.addEventListener("click", (e) => { e.stopPropagation(); abrirMenuMensaje(f, ctx, burbuja); });
  burbuja.appendChild(chev);

  mantenerPresionado(burbuja, () => abrirMenuMensaje(f, ctx, burbuja));
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

// ===== Mantener presionado (estilo WhatsApp) =====
function mantenerPresionado(nodo, cb) {
  let t = null, x0 = 0, y0 = 0;
  const parar = () => { clearTimeout(t); t = null; };
  const iniciar = (x, y, ms) => { parar(); x0 = x; y0 = y; t = setTimeout(() => { t = null; try { navigator.vibrate && navigator.vibrate(12); } catch (_) {} cb(x0, y0); }, ms); };
  nodo.addEventListener("touchstart", (e) => { if (e.touches.length !== 1 || e.target.closest("a,img,input,textarea")) return; iniciar(e.touches[0].clientX, e.touches[0].clientY, 450); }, { passive: true });
  nodo.addEventListener("touchmove", (e) => { const p = e.touches[0]; if (p && (Math.abs(p.clientX - x0) > 9 || Math.abs(p.clientY - y0) > 9)) parar(); }, { passive: true });
  ["touchend", "touchcancel"].forEach((n) => nodo.addEventListener(n, parar, { passive: true }));
  nodo.addEventListener("mousedown", (e) => { if (e.button !== 0 || e.target.closest("a,img,input,textarea,button")) return; iniciar(e.clientX, e.clientY, 500); });
  ["mouseup", "mouseleave"].forEach((n) => nodo.addEventListener(n, parar));
  nodo.addEventListener("mousemove", (e) => { if (t && (Math.abs(e.clientX - x0) > 9 || Math.abs(e.clientY - y0) > 9)) parar(); });
  nodo.addEventListener("contextmenu", (e) => { if (e.target.closest("a,img,input,textarea")) return; e.preventDefault(); parar(); cb(e.clientX, e.clientY); });
}
function cerrarMenuHold() { document.getElementById("zhold")?.remove(); }
// opciones = [[icono, texto, fn, peligro?]]; emojis = [{e, fn}]
function menuHold(x, y, opciones, emojis) {
  cerrarMenuHold();
  const m = document.createElement("div"); m.id = "zhold"; m.setAttribute("role", "menu");
  if (emojis && emojis.length) {
    const f = document.createElement("div"); f.className = "zh-em";
    emojis.forEach((o) => { const b = document.createElement("button"); b.type = "button"; b.textContent = o.e; b.onclick = () => { cerrarMenuHold(); o.fn(); }; f.appendChild(b); });
    m.appendChild(f);
  }
  opciones.filter(Boolean).forEach(([ic, tx, fn, mal]) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "zh-it" + (mal ? " zh-mal" : "");
    const i = document.createElement("span"); i.textContent = ic; const l = document.createElement("span"); l.textContent = tx; b.append(i, l);
    b.onclick = () => { cerrarMenuHold(); fn(); }; m.appendChild(b);
  });
  m.style.visibility = "hidden"; document.body.appendChild(m);
  const w = m.offsetWidth, h = m.offsetHeight, M = 10;
  m.style.left = Math.max(M, Math.min(x - w / 2, innerWidth - w - M)) + "px";
  m.style.top = Math.max(M, Math.min(y + 8 > innerHeight - h - M ? y - h - 8 : y + 8, innerHeight - h - M)) + "px";
  m.style.visibility = "";
}
document.addEventListener("pointerdown", (e) => { const z = document.getElementById("zhold"); if (z && !z.contains(e.target)) cerrarMenuHold(); }, true);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") cerrarMenuHold(); });
window.addEventListener("scroll", cerrarMenuHold, true);
Object.assign(window, { mantenerPresionado, menuHold });

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

async function esperarOrden(ordenId, alDemorar) {
  const fin = Date.now() + CONFIG.ESPERA_ORDEN_MS;
  const demora = Date.now() + 10000;
  let avisado = false;
  while (Date.now() < fin) {
    await dormir(1000);
    let respuesta;
    try { respuesta = await conTimeout(supabase.from("ordenes_recarga").select("estado").eq("id", ordenId).maybeSingle(), 8000); }
    catch (_) { continue; }   // una consulta colgada no frena la espera
    const { data, error } = respuesta;
    if (error || !data) continue;
    if (data.estado === "completada" || data.estado === "fallida") return data.estado;
    if (data.estado === "error_envio") return "pendiente";   // no tiene sentido seguir esperando
    if (!avisado && alDemorar && Date.now() > demora) { avisado = true; alDemorar(); }
  }
  return "pendiente";
}

// ¿Está encendido el servidor que entrega las recargas? (una consulta liviana, ~0,5 s; si no responde en 5 s se da por apagado)
async function servidorDisponible() {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await postWebhook({ ping: true }, 8000);
      if (r.ok || r.status < 500) return true;
    } catch (_) {}
    if (i === 0) await new Promise((x) => setTimeout(x, 700));
  }
  return false;
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
  if (msg.includes("BINANCE_BLOQUEADO")) { pintarBloqueoBinance(); return caso({ tono: "info", icono: "🔒", titulo: "Precios Binance bloqueados", texto: `Estos precios se desbloquean al recargar ${fmtNum(binMin())} 💎 en total. Mientras tanto podés comprar con los paquetes de Mercado Pago.` }); }
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
  if (moneda === "USD" && binanceBloqueado()) { pintarBloqueoBinance(); document.getElementById("bn-lock")?.scrollIntoView({ behavior: "smooth", block: "center" }); return mostrarAviso("Los precios Binance se desbloquean al recargar " + fmtNum(binMin()) + " 💎 en total.", "info"); }

  if (!usuarioActual) {
    mostrarAviso("Iniciá sesión con Google para comprar con tu saldo.", "error");
    if (!$("sidebar-menu")?.classList.contains("open")) toggleMenu();
    return;
  }
  const id = ($("player-id")?.value || "").trim();
  if (jugadorVerificado && jugadorVerificado.id === id && jugadorVerificado.noEncontrado) {
    mostrarAviso("ID no encontrado: puede estar mal escrito o ser de otra región. Con ese ID no se puede recargar.", "error");
    $("player-id")?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
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
    // (en paralelo: el saldo y si el servidor de recargas está encendido)
    const sondaServidor = servidorDisponible();
    try { await conTimeout(cargarSaldo(usuarioActual), 8000); } catch (_) { /* sin bloqueo */ }
    ctxError.saldo = saldos[moneda];
    const saldo = saldos[moneda];

    if (precio != null && saldo < precio) return mostrarErrorCompra({ message: "SALDO_INSUFICIENTE" }, ctxError);

    // Si el servidor de recargas está apagado, el cliente decide ANTES de pagar si quiere esperar
    let pedidoDemorado = false;
    if (!(await sondaServidor)) {
      const esperar = await mostrarConfirmacion({
        tono: "warn", icono: "⏳", titulo: "Tu recarga puede demorar",
        texto: "En este momento estamos procesando las recargas más lento de lo normal. Si comprás ahora, tu pedido queda en pendiente y se acredita apenas retomemos, y eso puede tardar varias horas.",
        nota: "Si preferís no esperar, cancelá y no se descuenta nada de tu saldo. Podés volver a intentarlo más tarde.",
        confirmar: "Quiero esperar", cancelar: "Cancelar compra",
      });
      if (!esperar) return;
      pedidoDemorado = true;
    }

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

    mostrarDialogo({ tono: "warn", titulo: "Procesando tu compra…", texto: "Un momento, estamos reservando tu pin.", cargando: true });

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
    try { iniciarSeguimiento(orden.orden_id, nombrePaquete); } catch (_) { /* decorativo */ }

    let estado = "completada";
    if (pedidoDemorado) {
      estado = "pendiente";   // el servidor estaba apagado: no se hace esperar al cliente frente a una pantalla de carga
    } else if (CONFIG.ESPERAR_CONFIRMACION) {
      const textoEspera = `${nombrePaquete} para el ID ${id}`;
      mostrarDialogo({ tono: "warn", titulo: "¡Carga enviada! 🚀", texto: `${textoEspera}. Se va a ver reflejada en tu cuenta en aproximadamente 1 minuto. Reiniciá el juego para ver tus diamantes. Si tarda más, escribinos por el chat de Almazarela.`, cargando: true });
      estado = await esperarOrden(orden.orden_id, () => mostrarDialogo({
        tono: "warn", titulo: "Está tardando un poco más…", cargando: true,
        texto: `${textoEspera}. Tu compra ya está registrada: si querés, podés cerrar esta ventana y fijarte en "Mi historial de compras".`,
        botones: [{ texto: "Cerrar y seguir", primario: true }],
      }));
    }

    if (estado === "completada") {
      const numCliente = await numeroDeCompra(orden.orden_id);
      let nj = "";
      try { const rn = await conTimeout(Promise.resolve(supabase.rpc("nombre_id", { p_id: id })), 3000); nj = rn && rn.data ? String(rn.data).slice(0, 40) : ""; } catch (_) {}
      if (nj) recordarNombre(id, nj); else nj = nombreGuardado(id);
      mostrarDialogo({
        tono: "ok", icono: "✅", titulo: "¡Compra exitosa!",
        texto: `Tus ${nombrePaquete} 💎 fueron acreditados a tu ID de Free Fire ${id}${nj ? " (" + nj + ")" : ""}. Reiniciá el juego para verlos.`,
        filas: [...(numCliente ? [["Compra", "#" + numCliente]] : []), ...(nj ? [["Jugador", nj]] : []), ["Saldo " + monedaOrden, formatoMoneda(monedaOrden, saldos[monedaOrden])]],
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
        texto: pedidoDemorado
          ? `Tu pedido quedó en pendiente. Tus diamantes se acreditan apenas retomemos las recargas. No hace falta que hagas nada más: podés seguirlo en "Mi historial de compras".`
          : `Tu pedido está en proceso. Tus diamantes se acreditan en unos minutos: reiniciá el juego para verlos. Si tarda, escribinos por el chat de Almazarela.`,
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
  ["modal-seleccion-carga", "modal-binance", "modal-mercadopago", "modal-convertir"].forEach((id) => {
    $(id)?.addEventListener("click", (e) => { if (e.target.id === id) mostrarModal(id, false); });
  });
});

// ------------------------- EXPOSICIÓN GLOBAL (onclick del HTML) ------
Object.assign(window, {
  cerrarChatAdmin,
  toggleMenu, agregarPinesStock,
  abrirModalSeleccionCarga, cerrarModalSeleccionCarga, avisarTarjetaProximamente,
  copiarDato, elegirMonto,
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
  publicarOpinion, cancelarEdicionOpinion, verMasOpiniones,
  loginConGoogle, logoutGoogle,
});

// ------------------------- FONDO SAKURA (solo PC) ----------------------
// Pétalos 3D que caen con el viento (el scroll los empuja).
(function sakura() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || window.matchMedia("(max-width: 600px)").matches) return;   // en celu no: que la página vuele
  const cel = window.matchMedia("(max-width: 800px)").matches;   // celu/tablet: menos pétalos y más chicos para no estorbar
  const cv = document.createElement("canvas");
  cv.id = "sakura-fx"; cv.setAttribute("aria-hidden", "true");
  document.body.appendChild(cv);
  const ctx = cv.getContext("2d");
  let W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
  let semilla = 7;
  const rnd = () => { semilla = (semilla * 16807) % 2147483647; return semilla / 2147483647; };   // aleatorio fijo: las ramas siempre salen iguales

  // ---- sprite de pétalo (con degradé para dar volumen)
  const sprites = [];
  [["#fff3f7", "#ffb7cf"], ["#ffe1ec", "#ff9ec0"], ["#ffd0e0", "#f77fab"]].forEach(([c1, c2]) => {
    const s = document.createElement("canvas"); s.width = 40; s.height = 40;
    const g = s.getContext("2d");
    const gr = g.createRadialGradient(20, 26, 2, 20, 20, 20);
    gr.addColorStop(0, c1); gr.addColorStop(1, c2);
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(20, 36);
    g.bezierCurveTo(2, 28, 0, 8, 14, 3);
    g.quadraticCurveTo(20, 8, 26, 3);      // muesca típica del pétalo de cerezo
    g.bezierCurveTo(40, 8, 38, 28, 20, 36);
    g.fill();
    g.strokeStyle = "rgba(255,255,255,.55)"; g.lineWidth = 1; g.stroke();
    sprites.push(s);
  });

  const petalos = [];
  function nuevoPetalo(arriba) {
    const z = 0.35 + Math.random() * 0.9;   // profundidad: más grande y rápido = más cerca
    return {
      x: Math.random() * W, y: arriba ? -30 - Math.random() * 100 : Math.random() * H, z,
      s: (10 + Math.random() * 12) * z * (cel ? 0.75 : 1), vy: (0.35 + Math.random() * 0.55) * (0.5 + z),
      ph: Math.random() * 6.28, vph: 0.012 + Math.random() * 0.02,
      rot: Math.random() * 6.28, vrot: (Math.random() - 0.5) * 0.04,
      voltea: Math.random() * 6.28, vvolt: 0.02 + Math.random() * 0.035,
      sp: sprites[(Math.random() * sprites.length) | 0],
    };
  }
  function medir() {
    W = innerWidth; H = innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = cel ? Math.round(Math.min(18, Math.max(12, W / 40))) : Math.round(Math.min(46, Math.max(24, W / 32)));
    while (petalos.length < n) petalos.push(nuevoPetalo(false));
    petalos.length = n;
  }
  medir();
  addEventListener("resize", medir);

  let viento = 0, ultimoY = scrollY, empuje = 0, vivo = true;
  addEventListener("scroll", () => { empuje += (scrollY - ultimoY) * 0.05; ultimoY = scrollY; }, { passive: true });
  document.addEventListener("visibilitychange", () => { vivo = !document.hidden; if (vivo) requestAnimationFrame(cuadro); });

  function cuadro(t) {
    if (!vivo) return;
    ctx.clearRect(0, 0, W, H);
    empuje *= 0.92;
    viento = Math.sin(t / 3200) * 0.6 + 0.35 + Math.max(-4, Math.min(4, empuje));

    for (const p of petalos) {
      p.ph += p.vph; p.rot += p.vrot + empuje * 0.004; p.voltea += p.vvolt;
      p.y += p.vy + Math.max(0, empuje) * 0.8 * p.z;
      p.x += Math.sin(p.ph) * 0.7 * p.z + viento * (0.4 + p.z * 0.9);
      if (p.y > H + 30 || p.x > W + 40 || p.x < -60) Object.assign(p, nuevoPetalo(true), { x: Math.random() * (W + 60) - 40 });
      const giro = Math.abs(Math.cos(p.voltea));          // el pétalo se "da vuelta" en 3D
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.globalAlpha = Math.min(0.9, 0.35 + p.z * 0.5);
      ctx.drawImage(p.sp, -p.s / 2, -p.s / 2 * (0.25 + giro * 0.75), p.s, p.s * (0.25 + giro * 0.75));
      ctx.restore();
    }
    requestAnimationFrame(cuadro);
  }
  requestAnimationFrame(cuadro);
})();

// ------------------------- FONDO CON PARALLAX (solo PC) -----------------
// La foto queda completa y nítida; al scrollear sube mucho más lento que el contenido y se mueve un poquito con el mouse.
(function fondoParalaje() {
  if (!window.matchMedia("(min-width: 801px)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const raiz = document.documentElement;
  let mx = 0, pendiente = false;
  const pintar = () => {
    pendiente = false;
    const y = -Math.min(scrollY * 0.07, innerHeight * 0.38);
    raiz.style.setProperty("--bgy", y.toFixed(1) + "px");
    raiz.style.setProperty("--bgx", (mx * -14).toFixed(1) + "px");
  };
  const pedir = () => { if (!pendiente) { pendiente = true; requestAnimationFrame(pintar); } };
  addEventListener("scroll", pedir, { passive: true });
  addEventListener("mousemove", (e) => { mx = e.clientX / innerWidth - 0.5; pedir(); }, { passive: true });
  pintar();
})();


// =====================================================================
// NOVEDADES PARA CLIENTES: cinta en vivo, IDs guardados, top del mes,
// seguimiento del pedido, aviso de acreditación, estado del servicio y ayuda de pago.
// Todo es opcional: si falta algo en la base, esa parte se oculta y la web sigue igual.
// =====================================================================
const fmtNum = (n) => Number(n).toLocaleString("es-AR");
function haceTexto(seg) {
  if (seg < 90) return "hace instantes";
  const m = Math.round(seg / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "hace 1 día" : `hace ${d} días`;
}

// ---- Cinta de compras recientes
let cintaDatos = [], cintaI = 0, cintaTimer = null, cintaFirma = null, cintaPausa = false;
function pintarCintaItem(nuevo) {
  const mov = $("zt-mov"); if (!mov || !cintaDatos.length) return;
  const c = cintaDatos[cintaI % cintaDatos.length];
  const it = document.createElement("span"); it.className = "zt-item zt-in" + (nuevo ? " zt-nuevo" : "");
  const b = document.createElement("b"); b.textContent = c.nombre || "Cliente";
  const em = document.createElement("em"); em.textContent = fmtNum(c.diamantes) + " 💎";
  it.append(b, " compró ", em, " ", Object.assign(document.createElement("small"), { textContent: haceTexto(Number(c.hace_seg) || 0) }));
  if (nuevo || Number(c.hace_seg) < 600) { const t = document.createElement("span"); t.className = "zt-chip"; t.textContent = nuevo ? "¡Nueva!" : "Recién"; it.appendChild(t); }
  mov.replaceChildren(it);
}
function rotarCinta() {
  clearInterval(cintaTimer); cintaTimer = null;
  if (cintaDatos.length < 2) return;
  cintaTimer = setInterval(() => { if (cintaPausa || document.hidden) return; cintaI = (cintaI + 1) % cintaDatos.length; pintarCintaItem(false); }, 4200);
}
async function cargarCinta() {
  const mov = $("zt-mov");
  if (!mov) return;
  try {
    const { data, error } = await conTimeout(supabase.rpc("compras_recientes"), 8000);
    if (error || !Array.isArray(data) || !data.length) return;
    cintaDatos = data;   // la más nueva primero: las anteriores quedan "detrás"
    const f = data[0], firma = (f.nombre || "") + "|" + f.diamantes + "|" + Math.round((Date.now() - (Number(f.hace_seg) || 0) * 1000) / 60000);
    const hayNueva = cintaFirma !== null && firma !== cintaFirma;
    cintaFirma = firma;
    mov.classList.add("zt-rot"); mov.style.removeProperty("--zt-dur");
    if (hayNueva || !mov.querySelector(".zt-item.zt-in")) { cintaI = 0; pintarCintaItem(hayNueva); }
    rotarCinta();
    const pista = mov.parentElement;
    if (pista && !pista.dataset.hover) { pista.dataset.hover = "1"; pista.addEventListener("mouseenter", () => { cintaPausa = true; }); pista.addEventListener("mouseleave", () => { cintaPausa = false; }); }
  } catch (_) { /* queda el texto fijo */ }
}

// ---- Últimas compras (slide del carrusel): 3 columnas x 10, con datos reales y en vivo
const TEMA_ULTIMAS = 2;   // 1..20: cambiá este número para otro diseño del slide
let ultimasDatos = [], ultimasFirma = null, ultimasT0 = 0, ultimasCompacto = false;
function haceCorto(seg) {
  if (seg < 90) return "ahora";
  const m = Math.round(seg / 60); if (m < 60) return m + " min";
  const h = Math.round(m / 60); if (h < 24) return h + " h";
  return Math.round(h / 24) + " d";
}
function pintarUltimas(nueva) {
  const cont = $("ul-cols"); if (!cont) return;
  const sl = $("slide-ult"); if (sl) sl.dataset.tema = String(TEMA_ULTIMAS);
  if (!ultimasDatos.length) return;
  const compacto = !!sl && sl.clientWidth > 0 && sl.clientWidth < 470;   // celular: 3 columnas x 5, solo el nombre de pila
  ultimasCompacto = compacto;
  const lista = ultimasDatos.slice(0, compacto ? 15 : 18);
  const por = Math.min(compacto ? 5 : 6, Math.ceil(lista.length / 3));   // columnas parejas aunque haya pocas compras
  cont.classList.toggle("ul-compacto", compacto);
  const extra = Math.round((Date.now() - ultimasT0) / 1000);
  const colores = [["#ff7a18", "#ffd23f"], ["#2979ff", "#00e5ff"], ["#b266ff", "#ff4fd8"], ["#19e68c", "#9dff6a"], ["#ff2d55", "#ff8a5c"]];
  cont.replaceChildren();
  for (let c = 0; c < 3; c++) {
    const trozo = lista.slice(c * por, c * por + por);
    if (!trozo.length) continue;
    const col = document.createElement("div"); col.className = "ul-col";
    const pista = document.createElement("div"); pista.className = "ul-pista";
    trozo.forEach((r, j) => {
      const i = c * por + j, completo = r.nombre || "Cliente", nombre = compacto ? completo.split(" ")[0] : completo;
      const fila = document.createElement("div"); fila.className = "ul-row" + (nueva && i === 0 ? " ul-nueva" : "");
      const letra = () => { const e = document.createElement("span"); e.className = "ul-av"; e.style.background = `linear-gradient(135deg,${colores[i % 5][0]},${colores[i % 5][1]})`; e.textContent = (nombre[0] || "C").toUpperCase(); return e; };
      let av;
      if (/^https:\/\//.test(r.avatar || "")) { av = document.createElement("img"); av.className = "ul-av"; av.alt = ""; av.referrerPolicy = "no-referrer"; av.src = r.avatar; av.addEventListener("error", () => av.replaceWith(letra())); }
      else av = letra();
      const tx = document.createElement("span"); tx.className = "ul-tx";
      const n = document.createElement("b"); n.className = "ul-nom"; n.textContent = nombre;
      const meta = document.createElement("span"); meta.className = "ul-meta";
      const d = document.createElement("em"); d.className = "ul-dia"; d.textContent = fmtNum(r.diamantes) + " 💎";
      const t = document.createElement("small"); t.className = "ul-t"; t.textContent = haceCorto((Number(r.hace_seg) || 0) + extra); if (compacto) t.textContent = t.textContent.replace(" min", "m").replace(" h", "h").replace(" d", "d");
      meta.append(d, t); tx.append(n, meta); fila.append(av, tx); pista.appendChild(fila);
    });
    col.appendChild(pista); cont.appendChild(col);
  }
  requestAnimationFrame(ajustarUltimas);
}
function ajustarUltimas() {   // si no entran las 10 filas (celular), la columna se desplaza sola, sin cortes
  document.querySelectorAll("#ul-cols .ul-col").forEach((col) => {
    const pista = col.firstElementChild; if (!pista) return;
    pista.classList.remove("ul-corre"); pista.querySelectorAll(".ul-clon").forEach((e) => e.remove());
    if (pista.scrollHeight > col.clientHeight + 2) {
      const filas = [...pista.children];
      filas.forEach((f) => { const k = f.cloneNode(true); k.classList.add("ul-clon"); k.setAttribute("aria-hidden", "true"); pista.appendChild(k); });
      pista.style.setProperty("--ul-dur", Math.max(12, filas.length * 2.6) + "s");
      pista.classList.add("ul-corre");
    }
  });
}
window.addEventListener("resize", () => { try { clearTimeout(ajustarUltimas.t); ajustarUltimas.t = setTimeout(() => { const sl = $("slide-ult"); const c = !!sl && sl.clientWidth > 0 && sl.clientWidth < 470; if (c !== ultimasCompacto) pintarUltimas(false); else ajustarUltimas(); }, 250); } catch (_) {} });
async function cargarUltimas() {
  if (!$("ul-cols")) return;
  try {
    let r = await conTimeout(supabase.rpc("compras_recientes_30"), 8000);
    if (r.error) r = await conTimeout(supabase.rpc("compras_recientes"), 8000);   // sin el SQL nuevo: las 12 de siempre
    const data = r.data;
    if (r.error || !Array.isArray(data) || !data.length) return;
    const f = data[0], firma = (f.nombre || "") + "|" + f.diamantes + "|" + Math.round((Date.now() - (Number(f.hace_seg) || 0) * 1000) / 60000);
    const hayNueva = ultimasFirma !== null && firma !== ultimasFirma;
    ultimasFirma = firma; ultimasDatos = data.slice(0, 30); ultimasT0 = Date.now();
    pintarUltimas(hayNueva);
  } catch (_) { /* queda el mensaje de espera */ }
}
document.addEventListener("DOMContentLoaded", () => { const sl = $("slide-ult"); if (sl) sl.dataset.tema = String(TEMA_ULTIMAS); });

// ---- Top compradores del mes
let topPrevio = null;
function pintarTopLista(data) {
  const ol = $("top-lista"); if (!ol) return;
    pintarTopCarrusel(data);
    const medallas = ["🥇", "🥈", "🥉", "4", "5", "6", "7", "8", "9", "10"];
    const colores = [["#ff7a18", "#ffd23f"], ["#2979ff", "#00e5ff"], ["#b266ff", "#ff4fd8"], ["#19e68c", "#9dff6a"], ["#ff2d55", "#ff8a5c"]];
    const abierto = ol.classList.contains("abierto");
    const filasLi = data.slice(0, 10).map((r, i) => {
      const nombre = r.nombre || "Cliente";
      const li = document.createElement("li"); li.className = "u" + i + (i < 3 ? " pod" : "") + (i >= 5 ? " top-extra" : "");
      const p = document.createElement("span"); p.className = "pos"; p.textContent = medallas[i] || String(i + 1);
      let av;
      const letra = () => { const s = document.createElement("span"); s.className = "av"; s.style.background = `linear-gradient(135deg,${colores[i % 5][0]},${colores[i % 5][1]})`; s.textContent = (nombre[0] || "C").toUpperCase(); return s; };
      if (/^https:\/\//.test(r.avatar || "")) {
        av = document.createElement("img"); av.className = "av"; av.alt = ""; av.referrerPolicy = "no-referrer"; av.src = r.avatar;
        av.addEventListener("error", () => av.replaceWith(letra()));
      } else av = letra();
      const n = document.createElement("span"); n.className = "nom";
      const t = document.createElement("span"); t.className = "t"; t.textContent = nombre;
      const nv = nivelDe(r.diamantes);
      let cajaN = n;
      if (nv >= 0) { cajaN = document.createElement("span"); cajaN.className = "nvb nvb-" + nv; cajaN.title = "Nivel " + NIVELES[nv].n; n.appendChild(cajaN); }
      cajaN.appendChild(t);
      if (nv >= 0) { const ic = document.createElement("span"); ic.className = "nvb-ico"; ic.textContent = NIVELES[nv].ico; cajaN.appendChild(ic); const tt = document.createElement("span"); tt.className = "nvb-t"; tt.textContent = NIVELES[nv].n; cajaN.appendChild(tt); }
      if (r.es_soporte) { const b = document.createElement("span"); b.className = "op-badge"; b.textContent = "✔ Oficial"; n.appendChild(b); }
      const d = document.createElement("span"); d.className = "dia"; d.textContent = fmtNum(r.diamantes) + " 💎";
      if (nv >= 0) { av.classList.add("av-en-nvb"); cajaN.insertBefore(av, cajaN.firstChild); li.append(p, n, d); }   // la insignia envuelve también la foto
      else li.append(p, av, n, d);
      return li;
    });
    if (data.length > 5) {
      const mas = document.createElement("li"); mas.className = "top-mas";
      const b = document.createElement("button"); b.type = "button"; b.className = "top-mas-btn"; b.setAttribute("aria-expanded", abierto ? "true" : "false");
      const txt = () => (ol.classList.contains("abierto") ? "Ocultar puestos 6 al " + Math.min(data.length, 10) : "Ver puestos 6 al " + Math.min(data.length, 10));
      b.innerHTML = `<span></span><i class="fa-solid fa-chevron-down"></i>`; b.firstChild.textContent = txt();
      b.addEventListener("click", () => { const o = ol.classList.toggle("abierto"); b.setAttribute("aria-expanded", String(o)); b.firstChild.textContent = txt(); });
      mas.appendChild(b); filasLi.splice(5, 0, mas);
    }
    ol.replaceChildren(...filasLi);
}

async function cargarTopMes() {
  const sec = $("top-mes"), ol = $("top-lista");
  if (!sec || !ol) return;
  try {
    let { data, error } = await conTimeout(supabase.rpc("top_compradores"), 8000);
    if (error) ({ data, error } = await conTimeout(supabase.rpc("top_compradores_mes"), 8000));
    if (error || !Array.isArray(data) || !data.length) { sec.hidden = true; return; }
    topPrevio = data.slice(0, 5);
    pintarTopLista(topPrevio);
    sec.hidden = false;
  } catch (_) { sec.hidden = true; }
}

// =====================================================================
// Respuestas rápidas (solo administradora): botón ⚡ y atajo "/" en los chats, "Todas las salas" y "Jugadores"
// =====================================================================
const RR_LS = "zarela_resp_rapidas";
let rrLista = [], rrTabla = true, rrCargada = false, rrCampo = null, rrSel = 0, rrFiltro = "";
const rrLeerLocal = () => { try { const v = JSON.parse(localStorage.getItem(RR_LS) || "[]"); return Array.isArray(v) ? v : []; } catch (_) { return []; } };
const rrGuardarLocal = () => { try { localStorage.setItem(RR_LS, JSON.stringify(rrLista)); } catch (_) {} };
async function rrCargar() {
  if (rrCargada) return rrLista;
  rrCargada = true;
  try {
    const { data, error } = await conTimeout(supabase.from("respuestas_rapidas").select("id, titulo, texto").order("orden", { ascending: true }).order("id", { ascending: true }), 8000);
    if (error) throw error;
    rrLista = data || [];
    const local = rrLeerLocal();
    if (!rrLista.length && local.length) {   // las que ya tenías en este navegador pasan al servidor
      for (const r of local) { const { data: n, error: e2 } = await supabase.from("respuestas_rapidas").insert({ titulo: r.titulo, texto: r.texto, orden: rrLista.length }).select("id, titulo, texto").single(); if (!e2 && n) rrLista.push(n); }
    }
  } catch (_) { rrTabla = false; rrLista = rrLeerLocal(); }
  return rrLista;
}
async function rrGuardar(item) {
  if (rrTabla) {
    try {
      if (item.id) {
        const { error } = await supabase.from("respuestas_rapidas").update({ titulo: item.titulo, texto: item.texto }).eq("id", item.id);
        if (error) throw error;
        const x = rrLista.find((r) => r.id === item.id); if (x) Object.assign(x, item);
      } else {
        const { data, error } = await supabase.from("respuestas_rapidas").insert({ titulo: item.titulo, texto: item.texto, orden: rrLista.length }).select("id, titulo, texto").single();
        if (error) throw error;
        rrLista.push(data);
      }
      return;
    } catch (_) { rrTabla = false; mostrarAviso("No se pudo guardar en el servidor: queda guardada solo en este navegador.", "error"); }
  }
  if (item.id) { const x = rrLista.find((r) => r.id === item.id); if (x) Object.assign(x, item); }
  else rrLista.push({ id: "l" + Date.now(), titulo: item.titulo, texto: item.texto });
  rrGuardarLocal();
}
async function rrBorrar(id) {
  if (rrTabla && !String(id).startsWith("l")) {
    try { const { error } = await supabase.from("respuestas_rapidas").delete().eq("id", id); if (error) throw error; }
    catch (_) { mostrarAviso("No se pudo borrar. Probá de nuevo.", "error"); return; }
  }
  rrLista = rrLista.filter((r) => r.id !== id);
  if (!rrTabla) rrGuardarLocal();
}
function rrBoton(campo) {
  const b = document.createElement("button");
  b.type = "button"; b.className = "rr-btn"; b.title = "Respuestas rápidas (también podés escribir /)"; b.setAttribute("aria-label", "Respuestas rápidas"); b.textContent = "⚡";
  b.addEventListener("click", (e) => { e.preventDefault(); rrAbrir(campo, "", true); });
  return b;
}
function rrCerrar() { $("rr-pop")?.remove(); rrCampo = null; }
function rrVisibles() {
  const q = rrFiltro.toLowerCase();
  return rrLista.filter((r) => !q || (r.titulo + " " + r.texto).toLowerCase().includes(q));
}
async function rrAbrir(campo, filtro, manual) {
  rrCampo = campo; rrFiltro = filtro || ""; rrSel = 0;
  await rrCargar();
  if (rrCampo !== campo) return;
  rrPintar(manual);
}
function rrPintar() {
  const campo = rrCampo; if (!campo) return;
  $("rr-pop")?.remove();
  const pop = document.createElement("div"); pop.id = "rr-pop"; pop.setAttribute("role", "listbox");
  const cab = document.createElement("div"); cab.className = "rr-cab"; cab.textContent = "⚡ Respuestas rápidas";
  const lista = document.createElement("div"); lista.className = "rr-lista";
  const vis = rrVisibles();
  if (rrSel >= vis.length) rrSel = Math.max(0, vis.length - 1);
  if (!vis.length) {
    const v = document.createElement("p"); v.className = "rr-vacio";
    v.textContent = rrLista.length ? "No hay respuestas que coincidan." : "Todavía no tenés respuestas. Tocá “＋ Nueva” para crear la primera.";
    lista.appendChild(v);
  }
  vis.forEach((r, i) => {
    const it = document.createElement("button"); it.type = "button"; it.className = "rr-it" + (i === rrSel ? " on" : "");
    const t = document.createElement("b"); t.textContent = r.titulo; const x = document.createElement("span"); x.textContent = r.texto;
    it.append(t, x);
    it.addEventListener("mousedown", (e) => e.preventDefault());
    it.addEventListener("click", () => rrInsertar(r.texto));
    lista.appendChild(it);
  });
  const pie = document.createElement("div"); pie.className = "rr-pie";
  const nueva = document.createElement("button"); nueva.type = "button"; nueva.textContent = "＋ Nueva"; nueva.addEventListener("mousedown", (e) => e.preventDefault()); nueva.addEventListener("click", () => rrEditor(null));
  const adm = document.createElement("button"); adm.type = "button"; adm.textContent = "✏️ Editar"; adm.addEventListener("mousedown", (e) => e.preventDefault()); adm.addEventListener("click", () => rrEditor("lista"));
  pie.append(nueva, adm);
  pop.append(cab, lista, pie);
  document.body.appendChild(pop);
  const r = campo.getBoundingClientRect(), ancho = Math.min(Math.max(r.width, 300), innerWidth - 16);
  pop.style.width = ancho + "px"; pop.style.left = Math.max(8, Math.min(r.left, innerWidth - ancho - 8)) + "px";
  if (r.top > 250) pop.style.bottom = (innerHeight - r.top + 6) + "px"; else pop.style.top = (r.bottom + 6) + "px";
  lista.querySelector(".rr-it.on")?.scrollIntoView({ block: "nearest" });
}
function rrInsertar(texto) {
  const c = rrCampo; if (!c) return;
  let v = c.value || "";
  v = /^\/\S*$/.test(v) ? texto : (v ? v.replace(/\s*$/, " ") + texto : texto);
  if (c.maxLength > 0) v = v.slice(0, c.maxLength);
  c.value = v;
  c.dispatchEvent(new Event("input", { bubbles: true }));
  rrCerrar(); c.focus(); try { c.setSelectionRange(v.length, v.length); } catch (_) {}
}
function rrEditor(modo) {   // modo null = nueva, "lista" = administrar, objeto = editar esa
  rrCerrar(); $("rr-modal")?.remove();
  const fondo = document.createElement("div"); fondo.id = "rr-modal"; fondo.className = "rr-modal";
  const caja = document.createElement("div"); caja.className = "rr-caja";
  const cerrar = () => fondo.remove();
  fondo.addEventListener("click", (e) => { if (e.target === fondo) cerrar(); });
  const h = document.createElement("h3"); h.textContent = "⚡ Respuestas rápidas";
  caja.appendChild(h);
  const form = document.createElement("div"); form.className = "rr-form";
  const ti = document.createElement("input"); ti.type = "text"; ti.maxLength = 60; ti.placeholder = "Título corto (ej: Datos de pago)";
  const tx = document.createElement("textarea"); tx.rows = 4; tx.maxLength = 1000; tx.placeholder = "El mensaje que querés mandar…";
  const nota = document.createElement("small"); nota.textContent = "Para avisos a salas y jugadores entran los primeros 300 caracteres.";
  const bGuardar = document.createElement("button"); bGuardar.type = "button"; bGuardar.className = "rr-ok"; bGuardar.textContent = "Guardar";
  let editando = null;
  const pintarLista = () => {
    lista.replaceChildren();
    if (!rrLista.length) { const v = document.createElement("p"); v.className = "rr-vacio"; v.textContent = "Todavía no hay respuestas."; lista.appendChild(v); }
    rrLista.forEach((r) => {
      const f = document.createElement("div"); f.className = "rr-fila";
      const t = document.createElement("div"); t.className = "rr-ft"; const b = document.createElement("b"); b.textContent = r.titulo; const sp = document.createElement("span"); sp.textContent = r.texto; t.append(b, sp);
      const e = document.createElement("button"); e.type = "button"; e.textContent = "✏️"; e.title = "Editar"; e.addEventListener("click", () => { editando = r; ti.value = r.titulo; tx.value = r.texto; bGuardar.textContent = "Guardar cambios"; ti.focus(); });
      const d = document.createElement("button"); d.type = "button"; d.textContent = "🗑"; d.title = "Borrar"; d.addEventListener("click", async () => { if (!confirm("¿Borrar la respuesta “" + r.titulo + "”?")) return; await rrBorrar(r.id); pintarLista(); });
      f.append(t, e, d); lista.appendChild(f);
    });
  };
  const lista = document.createElement("div"); lista.className = "rr-filas";
  bGuardar.addEventListener("click", async () => {
    const titulo = ti.value.trim(), texto = tx.value.trim();
    if (!titulo || !texto) { mostrarAviso("Poné un título y el mensaje.", "error"); return; }
    bGuardar.disabled = true;
    await rrGuardar({ id: editando ? editando.id : undefined, titulo, texto });
    bGuardar.disabled = false; editando = null; ti.value = ""; tx.value = ""; bGuardar.textContent = "Guardar"; pintarLista();
    mostrarAviso("Respuesta guardada.", "ok");
  });
  form.append(ti, tx, nota, bGuardar);
  const bCerrar = document.createElement("button"); bCerrar.type = "button"; bCerrar.className = "rr-cerrar"; bCerrar.textContent = "Listo"; bCerrar.addEventListener("click", cerrar);
  caja.append(form, lista, bCerrar); fondo.appendChild(caja); document.body.appendChild(fondo);
  pintarLista(); rrCargar().then(pintarLista);
  setTimeout(() => ti.focus(), 50);
}
const RR_CAMPOS = ["admin-respuesta", "sl-texto", "jg-texto"];
document.addEventListener("input", (e) => {
  const c = e.target; if (!c || !RR_CAMPOS.includes(c.id)) return;
  if (/^\/\S*$/.test(c.value || "")) { if (rrCampo === c) { rrFiltro = c.value.slice(1); rrSel = 0; rrPintar(); } else rrAbrir(c, c.value.slice(1)); }
  else if (rrCampo === c) rrCerrar();
});
document.addEventListener("keydown", (e) => {
  if (!rrCampo || !$("rr-pop")) return;
  const vis = rrVisibles();
  if (e.key === "Escape") { e.preventDefault(); rrCerrar(); }
  else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (vis.length) { rrSel = (rrSel + (e.key === "ArrowDown" ? 1 : vis.length - 1)) % vis.length; rrPintar(); } }
  else if ((e.key === "Enter" || e.key === "Tab") && vis.length && e.target === rrCampo) { e.preventDefault(); e.stopImmediatePropagation(); rrInsertar(vis[rrSel].texto); }
}, true);
document.addEventListener("pointerdown", (e) => { if (rrCampo && !e.target.closest("#rr-pop") && !e.target.closest(".rr-btn") && e.target !== rrCampo) rrCerrar(); });
document.addEventListener("DOMContentLoaded", () => {
  ["sl-texto", "jg-texto"].forEach((id) => {
    const t = $(id); if (!t || t.dataset.rr) return; t.dataset.rr = "1";
    const barra = document.createElement("div"); barra.className = "rr-barra";
    const tip = document.createElement("small"); tip.textContent = "Tip: escribí / para ver tus respuestas rápidas";
    barra.append(rrBoton(t), tip); t.parentNode.insertBefore(barra, t);
  });
});
Object.assign(window, { rrEditor });

// ---- Estado del servicio (cinta + menú lateral)
async function actualizarEstadoServicio() {
  if (document.hidden) return;
  const ok = await servidorDisponible();
  if (servidorLento === ok) { servidorLento = !ok; try { pintarSoporte(soporteBase); } catch (_) {} }
  const z = $("zt-estado");
  if (z) { z.classList.toggle("lento", !ok); z.querySelector("b").textContent = ok ? "Recargas activas" : "Recargas demoradas"; }
  const sb = document.querySelector(".status-indicator");
  if (sb) {
    sb.querySelector(".status-dot")?.classList.toggle("online", ok);
    const t = $("sb-estado-txt"); if (t) t.textContent = ok ? "ONLINE" : "DEMORADO";
  }
}

// ---- IDs guardados
let idsGuardados = [];
let idsEnTabla = true;
const claveIds = () => "zarela_ids:" + (usuarioActual ? usuarioActual.id : "");
function leerIdsLocal() { try { return JSON.parse(localStorage.getItem(claveIds()) || "[]"); } catch (_) { return []; } }
function guardarIdsLocal() { try { localStorage.setItem(claveIds(), JSON.stringify(idsGuardados)); } catch (_) {} }

async function cargarIdsGuardados() {
  idsGuardados = [];
  if (usuarioActual) {
    try {
      const { data, error } = await conTimeout(supabase.from("ids_guardados").select("id, id_jugador, apodo").order("created_at", { ascending: false }).limit(6), 8000);
      if (error) throw error;
      idsGuardados = data || []; idsEnTabla = true;
    } catch (_) { idsEnTabla = false; idsGuardados = leerIdsLocal(); }
  }
  pintarIdsGuardados();
}
async function completarApodo() {
  const v = jugadorVerificado;
  if (!usuarioActual || !v || !v.validado || !v.nombre) return;
  const x = idsGuardados.find((y) => y.id_jugador === v.id);
  if (!x || x.apodo === v.nombre.slice(0, 30)) return;
  x.apodo = v.nombre.slice(0, 30);
  if (idsEnTabla) { try { await supabase.from("ids_guardados").update({ apodo: x.apodo }).eq("id", x.id); } catch (_) {} } else guardarIdsLocal();
  pintarIdsGuardados();
}
let ziAbierto = false;
function pintarIdsGuardados() {
  const caja = $("ids-guardados"), lista = $("zi-lista"), btn = $("zi-guardar");
  if (!caja) return;
  const actual = ($("player-id")?.value || "").trim();
  const valido = /^\d{5,15}$/.test(actual);
  const yaEsta = idsGuardados.some((x) => x.id_jugador === actual);
  const hacerChip = (x) => {
    const chip = document.createElement("span"); chip.className = "zi-chip";
    const b = document.createElement("button"); b.type = "button"; b.title = "Usar este ID";
    b.append(x.apodo ? x.apodo : x.id_jugador);
    if (x.apodo) { const sm = document.createElement("small"); sm.textContent = x.id_jugador.slice(-4).padStart(x.id_jugador.length > 4 ? 5 : 4, "…"); b.append(sm); }
    b.onclick = () => { ziAbierto = false; $("player-id").value = x.id_jugador; alEditarId(); pintarIdsGuardados(); verificarJugador(); };
    const del = document.createElement("button"); del.type = "button"; del.className = "zi-x"; del.textContent = "✕"; del.title = "Borrar este ID guardado";
    del.onclick = () => borrarIdGuardado(x);
    chip.append(b, del); return chip;
  };
  // El primero guardado queda a la vista; todos los demás van en el desplegable "Mis ID guardados"
  const filas = idsGuardados.length ? [hacerChip(idsGuardados[0])] : [];
  if (idsGuardados.length > 1) {
    const mas = document.createElement("button"); mas.type = "button"; mas.className = "zi-mas" + (ziAbierto ? " abierto" : "");
    mas.setAttribute("aria-expanded", String(ziAbierto));
    mas.innerHTML = '<i class="fa-solid fa-folder-open"></i> Mis ID guardados <em>' + idsGuardados.length + '</em> <i class="fa-solid fa-chevron-down zi-fl"></i>';
    mas.onclick = () => { ziAbierto = !ziAbierto; pintarIdsGuardados(); };
    filas.push(mas);
    if (ziAbierto) {
      const panel = document.createElement("div"); panel.className = "zi-panel";
      idsGuardados.forEach((x) => panel.appendChild(hacerChip(x)));
      filas.push(panel);
    }
  }
  lista.replaceChildren(...filas);
  const puedeGuardar = !!usuarioActual && valido && !yaEsta && idsGuardados.length < 6;
  btn.hidden = !puedeGuardar;
  caja.hidden = !usuarioActual || (!idsGuardados.length && !puedeGuardar);
}
async function guardarIdActual() {
  const id = ($("player-id")?.value || "").trim();
  if (!usuarioActual || !/^\d{5,15}$/.test(id) || idsGuardados.some((x) => x.id_jugador === id)) return;
  const apodo = jugadorVerificado && jugadorVerificado.id === id && jugadorVerificado.nombre ? jugadorVerificado.nombre.slice(0, 30) : null;
  if (idsEnTabla) {
    const { error } = await supabase.from("ids_guardados").insert({ id_jugador: id, apodo });
    if (error) idsEnTabla = false;
  }
  if (idsEnTabla) await cargarIdsGuardados();
  else { idsGuardados = [{ id: Date.now(), id_jugador: id, apodo }, ...idsGuardados].slice(0, 6); guardarIdsLocal(); pintarIdsGuardados(); }
  mostrarAviso("ID guardado.", "ok");
}
async function borrarIdGuardado(x) {
  idsGuardados = idsGuardados.filter((y) => y !== x);
  if (idsEnTabla) { try { await supabase.from("ids_guardados").delete().eq("id", x.id); } catch (_) {} } else guardarIdsLocal();
  pintarIdsGuardados();
}

// Número de compra del propio cliente (su 1.ª, 2.ª, 3.ª recarga), no el número general de la tienda
async function numeroDeCompra(ordenId) {
  if (!usuarioActual) return null;
  try {
    const r = await conTimeout(supabase.from("ordenes_recarga").select("id", { count: "exact", head: true }).eq("user_id", usuarioActual.id).lte("id", ordenId), 8000);
    return !r.error && Number.isFinite(r.count) && r.count > 0 ? r.count : null;
  } catch (_) { return null; }
}
// ---- Seguimiento del pedido + aviso de acreditación
let seg = null, segTimer = null;
const claveCerrada = () => "zarela_seg_cerrado";
function textoPaso(estado) {
  if (estado === "completada") return ["¡Listo! Tus diamantes ya están en tu cuenta. Reiniciá el juego para verlos.", 4];
  if (estado === "fallida") return ["No se pudo acreditar. Tu saldo fue devuelto.", -1];
  if (estado === "error_envio") return ["En espera: se acredita apenas retomemos las recargas.", 2];
  if (seg && seg.desde && Date.now() - seg.desde > 6 * 60000) return ["Tu pedido está en revisión: lo estamos verificando a mano. Tu pago está registrado y no se pierde. Te avisamos apenas se resuelva.", 2];
  return ["Cargando tus diamantes… suele tardar menos de un minuto.", 2];
}
function pintarSeguimiento() {
  const caja = $("seguimiento");
  if (!caja || !seg) { if (caja) caja.hidden = true; return; }
  $("seg-num").textContent = seg.num ? "#" + seg.num : "";
  $("seg-paq").textContent = seg.paquete ? "· " + seg.paquete : "";
  const [txt, activo] = textoPaso(seg.estado);
  $("seg-txt").textContent = txt;
  caja.querySelectorAll("#seg-pasos li").forEach((li) => {
    const p = Number(li.dataset.p);
    li.className = activo === -1 ? (p <= 1 ? "hecho" : p === 2 ? "error" : "") : p < activo ? "hecho" : p === activo ? "activo" : "";
  });
  const pedir = "Notification" in window && Notification.permission === "default" && seg.estado !== "completada" && seg.estado !== "fallida";
  $("seg-aviso").hidden = !pedir;
  caja.hidden = false;
}
function avisarAcreditada(seguimiento) {
  const texto = `¡Tus ${seguimiento.paquete || "diamantes"} ya están acreditados! 💎`;
  if (!comprando) mostrarAviso(texto, "ok");
  if (document.hidden) {
    const tit = document.title; let n = 0;
    const t = setInterval(() => { document.title = n++ % 2 ? tit : "💎 ¡Carga acreditada!"; if (!document.hidden || n > 40) { clearInterval(t); document.title = tit; } }, 1000);
    try { if (!pushActivo && "Notification" in window && Notification.permission === "granted") new Notification("Zarela", { body: texto }); } catch (_) {}
  }
}
async function consultarSeguimiento() {
  if (!seg || !usuarioActual) return;
  try { if (seg.estado === "pendiente") supabase.rpc("promo_liberar_mis_vencidas").then(() => {}, () => {}); } catch (_) {}
  try {
    const { data, error } = await conTimeout(supabase.from("ordenes_recarga").select("estado").eq("id", seg.id).maybeSingle(), 8000);
    if (error || !data) return;
    const antes = seg.estado;
    seg.estado = data.estado;
    pintarSeguimiento();
    if (data.estado === "completada" || data.estado === "fallida") {
      clearInterval(segTimer); segTimer = null;
      if (antes !== data.estado && seg.visto) {
        if (data.estado === "completada") avisarAcreditada(seg); else cargarSaldo(usuarioActual);
      }
    }
  } catch (_) {}
}
function iniciarSeguimiento(id, paquete, estado = "pendiente", visto = true) {
  if (!id) return;
  seg = { id, paquete, estado, visto, num: null, desde: Date.now() };
  const miSeg = seg;
  numeroDeCompra(id).then((n) => { if (seg === miSeg) { seg.num = n; pintarSeguimiento(); } });
  pintarSeguimiento();
  clearInterval(segTimer); segTimer = null;
  if (estado !== "completada" && estado !== "fallida") segTimer = setInterval(consultarSeguimiento, 5000);
}
async function buscarPedidoReciente() {
  if (!usuarioActual) { seg = null; clearInterval(segTimer); pintarSeguimiento(); return; }
  try {
    const { data } = await conTimeout(supabase.from("ordenes_recarga").select("id, estado, diamantes, created_at").eq("user_id", usuarioActual.id).order("created_at", { ascending: false }).limit(1), 8000);
    const o = data && data[0];
    if (!o) return;
    const edadMin = (Date.now() - new Date(o.created_at).getTime()) / 60000;
    const activa = o.estado === "pendiente" || o.estado === "error_envio";
    let cerrada = false; try { cerrada = sessionStorage.getItem(claveCerrada()) === String(o.id); } catch (_) {}
    if (cerrada || (!activa && edadMin > 10)) return;
    iniciarSeguimiento(o.id, o.diamantes ? fmtNum(o.diamantes) + " 💎" : "", o.estado, true);
    if (seg && seg.id === o.id) { seg.desde = new Date(o.created_at).getTime(); pintarSeguimiento(); }
  } catch (_) {}
}

// ---- Ayuda "?" en los modales de pago
const SVG_GUIA = {
  copiar: '<svg viewBox="0 0 84 56"><rect x="8" y="12" width="68" height="32" rx="7" fill="#1b2033" stroke="#38426a"/><text x="16" y="32" fill="#fff" font-size="11" font-family="sans-serif" font-weight="700">tu.alias</text><rect x="52" y="19" width="20" height="18" rx="4" fill="#38bdf8"/><rect x="58" y="23" width="9" height="11" rx="2" fill="none" stroke="#04121c" stroke-width="1.6"/></svg>',
  pagar: '<svg viewBox="0 0 84 56"><rect x="26" y="4" width="32" height="48" rx="6" fill="#1b2033" stroke="#38426a"/><rect x="31" y="12" width="22" height="9" rx="3" fill="#2ecc70"/><text x="35" y="19.5" fill="#04210f" font-size="7" font-family="sans-serif" font-weight="800">$ OK</text><rect x="31" y="26" width="22" height="3" rx="1.5" fill="#38426a"/><rect x="31" y="32" width="16" height="3" rx="1.5" fill="#38426a"/><path d="M8 28h14m-5-5 5 5-5 5" stroke="#f3ba2f" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chat: '<svg viewBox="0 0 84 56"><rect x="6" y="4" width="72" height="48" rx="7" fill="#1b2033" stroke="#38426a"/><rect x="12" y="11" width="34" height="8" rx="4" fill="#2a3047"/><rect x="36" y="23" width="34" height="8" rx="4" fill="#1f5a3a"/><circle cx="66" cy="42" r="8" fill="#25d366"/><path d="M62 39h8v6h-5l-3 3z" fill="#fff"/><path d="M49 49 59 44" stroke="#f3ba2f" stroke-width="2" stroke-linecap="round"/></svg>',
};
function montarAyudaPagos() {
  [["modal-mercadopago", "el alias"], ["modal-binance", "el Pay ID"]].forEach(([mid, dato]) => {
    const modal = $(mid); if (!modal) return;
    const primero = modal.querySelector(".pay-dato"); if (!primero || primero.querySelector(".pay-ayuda")) return;
    const guia = document.createElement("div"); guia.className = "pay-guia"; guia.hidden = true;
    guia.innerHTML = `<ol>
      <li>${SVG_GUIA.copiar}<span><b>1.</b> Tocá <b>Copiar</b> para llevarte ${dato}.</span></li>
      <li>${SVG_GUIA.pagar}<span><b>2.</b> Hacé la transferencia desde tu app del banco o billetera.</span></li>
      <li>${SVG_GUIA.chat}<span><b>3.</b> Mandanos la <b>captura del pago por el chat</b>: botón verde <b>Chat</b> (abajo a la derecha) o <b>Ir al chat</b>.</span></li></ol>
      <p class="zg-fin">Te respondemos lo antes posible y acreditamos tu saldo. 💚</p>`;
    const b = document.createElement("button"); b.type = "button"; b.className = "pay-ayuda"; b.textContent = "?"; b.title = "¿Cómo cargo saldo?"; b.setAttribute("aria-label", "Ayuda para cargar saldo");
    b.onclick = () => { guia.hidden = !guia.hidden; b.classList.toggle("on", !guia.hidden); };
    primero.appendChild(b);
    const ultimo = [...modal.querySelectorAll(".pay-dato")].pop();
    ultimo.insertAdjacentElement("afterend", guia);
  });
}

// ---- Arranque
(function iniciarNovedades() {
  const arrancar = () => {
    cargarUltimas(); cargarTopMes(); montarAyudaPagos();
    actualizarEstadoServicio();
    setInterval(actualizarEstadoServicio, 180000);
    setInterval(() => { if (!document.hidden) cargarUltimas(); }, 5000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) cargarUltimas(); });
    $("player-id")?.addEventListener("input", pintarIdsGuardados);
    $("zi-guardar")?.addEventListener("click", guardarIdActual);
    $("seg-x")?.addEventListener("click", () => { try { sessionStorage.setItem(claveCerrada(), String(seg?.id)); } catch (_) {} seg = null; clearInterval(segTimer); pintarSeguimiento(); });
    $("seg-aviso")?.addEventListener("click", async () => { try { await Notification.requestPermission(); } catch (_) {} pintarSeguimiento(); });
    const alCambioJugador = new MutationObserver(() => { completarApodo(); pintarIdsGuardados(); });
    const pc = $("player-card"); if (pc) alCambioJugador.observe(pc, { attributes: true, attributeFilter: ["hidden"] });
    let ultimoUid = null;
    supabase.auth.onAuthStateChange((_e, session) => {
      const uid = session?.user?.id || null;
      if (uid === ultimoUid) return;
      ultimoUid = uid;
      setTimeout(() => { cargarIdsGuardados(); buscarPedidoReciente(); }, 80);
    });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", arrancar); else arrancar();
})();


// =====================================================================
// v3: datos de cobro editables, conversión ARS -> USD, chip "Mis compras"
// =====================================================================
const COBRO_DEF = { alias_mp: "almazarela.com", cvu_mp: "0000003100098290851840", titular_mp: "Julian Pereyra", binance_id: "1252553144", tasa_ars_usd: "1700", nivel_1: "110", nivel_2: "1000", nivel_3: "3000", nivel_p: "5000", nivel_4: "7000", nivel_h: "10000", nivel_m: "12500", nivel_5: "15000", binance_min: "1000" };
let cobro = { ...COBRO_DEF };
function aplicarCobro() {
  const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
  set("modal-mercadopago-dato", cobro.alias_mp);
  set("modal-mercadopago-cvu", cobro.cvu_mp);
  set("mp-titular", cobro.titular_mp);
  set("modal-binance-dato", cobro.binance_id);
  document.querySelectorAll(".js-alias").forEach((e) => { e.textContent = cobro.alias_mp; });
  document.querySelectorAll(".js-titular").forEach((e) => { e.textContent = cobro.titular_mp; });
  document.querySelectorAll(".js-bn").forEach((e) => { e.textContent = cobro.binance_id; });
  pintarNivel(); if (typeof topPrevio !== "undefined" && topPrevio) pintarTopLista(topPrevio);
  set("conv-tasa", "1 USD = " + formatoARS(Number(cobro.tasa_ars_usd)).replace(/,00$/, ""));
  try { pintarBloqueoBinance(); pintarPrecios(); } catch (_) {}
}
async function cargarCobro() {
  try {
    const { data, error } = await conTimeout(supabase.from("config_pago").select("clave, valor"), 8000);
    if (!error && Array.isArray(data)) data.forEach((r) => { if (r.clave in COBRO_DEF && r.valor) cobro[r.clave] = r.valor; });
  } catch (_) { /* quedan los datos por defecto */ }
  aplicarCobro();
}
function rellenarCobro() {
  Object.keys(COBRO_DEF).forEach((k) => { const i = $("cobro-" + k); if (i) i.value = cobro[k]; });
  rellenarPreciosAdmin();
}
async function guardarCobro() {
  const btn = $("cobro-guardar"); btn.disabled = true;
  try {
    const nv = ["nivel_1", "nivel_2", "nivel_3", "nivel_p", "nivel_4", "nivel_h", "nivel_m", "nivel_5"].map((k) => Number($("cobro-" + k)?.value));
    if (!(Number($("cobro-binance_min")?.value) > 0)) { mostrarAviso("Poné cuántos diamantes hay que cargar para desbloquear Binance (un número mayor a 0).", "error"); return; }
    if (nv.some((x, i) => !(x > 0) || (i && x <= nv[i - 1]))) { mostrarAviso("Los niveles tienen que ser números que van subiendo (cada uno mayor al anterior).", "error"); return; }
    let n = 0;
    for (const k of Object.keys(COBRO_DEF)) {
      const v = ($("cobro-" + k)?.value || "").trim();
      if (!v || v === cobro[k]) continue;
      const { error } = await supabase.rpc("admin_guardar_config_pago", { p_clave: k, p_valor: v });
      if (error) { mostrarAviso(/TASA/.test(error.message) ? "La tasa tiene que ser un número mayor a 0." : /NO_AUTORIZADO/.test(error.message) ? "Falta ejecutar novedades_clientes_v4.sql en Supabase." : /CLAVE_INVALIDA/.test(error.message) ? "Falta ejecutar novedades_clientes_v8.sql en Supabase." : "No se pudo guardar. ¿Ejecutaste novedades_clientes_v3.sql y v4?", "error"); return; }
      cobro[k] = v; n++;
    }
    const np = await guardarPrecios();
    if (np === false) return;
    aplicarCobro();
    n += np;
    mostrarAviso(n ? "Cambios guardados. Ya los ven todos los clientes." : "No había cambios para guardar.", n ? "ok" : "info");
  } finally { btn.disabled = false; }
}

// ---- Conversión de pesos a dólares
function abrirModalConvertir() {
  if (!usuarioActual) { mostrarAviso("Iniciá sesión con Google para convertir tu saldo.", "error"); return; }
  cerrarTodosLosModales(); aplicarCobro();
  $("conv-saldo").textContent = formatoARS(saldos.ARS) + " ARS";
  $("conv-monto").value = ""; convPreview();
  mostrarModal("modal-convertir", true);
}
function cerrarModalConvertir() { mostrarModal("modal-convertir", false); }
const convTasa = () => Number(cobro.tasa_ars_usd) > 0 ? Number(cobro.tasa_ars_usd) : 1700;
function convMonto(n) { $("conv-monto").value = Math.min(n, Math.floor(saldos.ARS)); convPreview(); }
function convTodo() { $("conv-monto").value = Math.floor(saldos.ARS); convPreview(); }
function convPreview() {
  const m = Number($("conv-monto").value) || 0;
  $("conv-res").innerHTML = `Vas a recibir <b>US$ ${(Math.floor(m / convTasa() * 100) / 100).toLocaleString("es-AR", { minimumFractionDigits: 2 })}</b>`;
}
async function confirmarConversion() {
  const m = Number($("conv-monto").value) || 0;
  const tasa = convTasa();
  if (m < tasa * 0.5) return mostrarAviso(`El mínimo para convertir es ${formatoARS(Math.ceil(tasa * 0.5)).replace(/,00$/, "")}.`, "error");
  if (m > saldos.ARS) return mostrarAviso("No tenés tanto saldo en pesos.", "error");
  const usd = Math.round((m / tasa) * 100) / 100;
  cerrarModalConvertir();
  const ok = await mostrarConfirmacion({
    tono: "ok", icono: "💱", titulo: "Confirmá la conversión",
    filas: [["Convertís", formatoARS(m) + " ARS"], ["Tasa", "1 USD = " + formatoARS(tasa).replace(/,00$/, "")], ["Recibís", "US$ " + usd.toLocaleString("es-AR", { minimumFractionDigits: 2 })]],
    nota: "La conversión no se puede deshacer.", confirmar: "Convertir",
  });
  if (!ok) return;
  mostrarDialogo({ tono: "warn", titulo: "Convirtiendo…", texto: "Un momento.", cargando: true });
  const { data, error } = await supabase.rpc("convertir_ars_a_usd", { p_monto_ars: m });
  if (error) {
    const t = /SALDO/.test(error.message) ? "No tenés saldo suficiente en pesos." : /MONTO/.test(error.message) ? "El monto es muy bajo." : "No pudimos convertir. No se descontó nada. Probá de nuevo o escribinos por el chat.";
    return mostrarDialogo({ tono: "error", icono: "⚠️", titulo: "No se pudo convertir", texto: t, botones: [{ texto: "Cerrar", primario: true }] });
  }
  if (data) { pintarSaldo(data.saldo_ars, "ARS"); pintarSaldo(data.saldo_usd, "USD"); } else cargarSaldo(usuarioActual);
  mostrarDialogo({ tono: "ok", icono: "✅", titulo: "¡Listo!", texto: `Convertiste ${formatoARS(m)} ARS a US$ ${usd.toLocaleString("es-AR", { minimumFractionDigits: 2 })}.`, botones: [{ texto: "Genial", primario: true, verde: true }] });
}
Object.assign(window, { abrirModalConvertir, cerrarModalConvertir, convMonto, convTodo, convPreview, confirmarConversion, guardarCobro });

// ---- Chip "Mis compras" junto al título (se ve solo con sesión; copia el contador de pedidos en proceso)
(function chipCompras() {
  const sync = () => {
    const chip = $("chip-compras"); if (!chip) return;
    chip.hidden = !usuarioActual;
    const c = $("hist-contador"), n = $("chip-compras-n");
    const v = c && !c.hidden ? c.textContent : "";
    if (n) { n.textContent = v; n.hidden = !v; }
  };
  setInterval(() => { if (!document.hidden) sync(); }, 1500);
  document.addEventListener("DOMContentLoaded", () => { sync(); cargarCobro(); });
})();


// =====================================================================
// v5: bloqueo de usuarios (comentarios ocultos para los demás; el chat sigue funcionando),
// movimientos de saldo en el panel y Top de recargas en el carrusel
// =====================================================================
let bloqueados = new Set();
async function cargarBloqueados() {
  if (!esAdminActual()) return;
  try {
    const { data, error } = await conTimeout(supabase.from("usuarios_baneados").select("user_id"), 8000);
    if (!error && Array.isArray(data)) { bloqueados = new Set(data.map((r) => r.user_id)); if (opCargadas) renderOpiniones(); }
  } catch (_) {}
}
async function alternarBloqueo(userId, nombre) {
  if (!esAdminActual() || !userId) return;
  const yaBloq = bloqueados.has(userId);
  const ok = await mostrarConfirmacion({
    tono: yaBloq ? "ok" : "warn", icono: yaBloq ? "✅" : "🚫",
    titulo: yaBloq ? "¿Desbloquear a " + (nombre || "este usuario") + "?" : "¿Bloquear a " + (nombre || "este usuario") + "?",
    texto: yaBloq ? "Sus comentarios y respuestas vuelven a verse para todos."
      : "Sus comentarios y respuestas dejan de verse para los demás. Él los sigue viendo como siempre, así no se entera. El chat con vos sigue funcionando.",
    confirmar: yaBloq ? "Desbloquear" : "Bloquear", cancelar: "Cancelar",
  });
  if (!ok) return;
  const { error } = await supabase.rpc(yaBloq ? "admin_desbloquear_usuario" : "admin_bloquear_usuario", yaBloq ? { p_user_id: userId } : { p_user_id: userId, p_motivo: null });
  if (error) return mostrarAviso("No se pudo cambiar el bloqueo. ¿Ejecutaste novedades_clientes_v5.sql?", "error");
  if (yaBloq) bloqueados.delete(userId); else bloqueados.add(userId);
  mostrarAviso(yaBloq ? "Usuario desbloqueado." : "Usuario bloqueado: sus comentarios ya no se ven.", "ok");
}

// ---- Movimientos de saldo del cliente (incluye las conversiones de pesos a dólares)
async function agregarMovimientos(vista, userId) {
  const det = document.createElement("details");
  det.style.cssText = "background:#161822;border:1px solid #2b3544;border-radius:10px;padding:8px 10px;margin-bottom:10px;font-size:12px;color:#cfd8f5;";
  const sm = document.createElement("summary"); sm.style.cssText = "cursor:pointer;font-weight:700;"; sm.textContent = "📒 Últimos movimientos de saldo";
  const cuerpo = document.createElement("div"); cuerpo.style.cssText = "margin-top:8px;display:grid;gap:5px;"; cuerpo.textContent = "Cargando…";
  det.append(sm, cuerpo);
  const cab = vista.querySelector(".adm-cab"); (cab ? cab.insertAdjacentElement("afterend", det) : vista.appendChild(det));
  det.addEventListener("toggle", async () => {
    if (!det.open || det.dataset.ok) return;
    det.dataset.ok = "1";
    const { data, error } = await supabase.from("saldo_movimientos").select("created_at, moneda, monto, nota, modo").eq("user_id", userId).order("created_at", { ascending: false }).limit(10);
    cuerpo.replaceChildren();
    if (error || !data?.length) { cuerpo.textContent = error ? "No se pudieron cargar." : "Sin movimientos todavía."; return; }
    data.forEach((m) => {
      const f = document.createElement("div"); f.style.cssText = "display:flex;justify-content:space-between;gap:8px;background:#0e0f16;border-radius:7px;padding:5px 8px;";
      const monto = Number(m.monto) || 0, mon = m.moneda === "ARS" ? "ARS" : "USD";
      const izq = document.createElement("span"); izq.textContent = `${fechaHora(m.created_at)} · ${m.nota || (m.modo === "establecer" ? "Saldo establecido" : "Ajuste")}`;
      const der = document.createElement("b"); der.style.color = monto < 0 ? "#ff9c9c" : "#7dffb0"; der.textContent = (monto > 0 ? "+" : "") + formatoMoneda(mon, monto) + " " + mon;
      f.append(izq, der); cuerpo.appendChild(f);
    });
  });
}

// ---- Top de recargas dentro del carrusel
function pintarTopCarrusel(data) {
  const cont = $("st-lista"); if (!cont || !data?.length) return;
  const colores = [["#19e68c", "#7fd6ff"], ["#2979ff", "#00e5ff"], ["#5b8cff", "#9ad8ff"], ["#0b5d3f", "#19e68c"], ["#1c3f8f", "#7fd6ff"]];
  const medallas = ["🥇", "🥈", "🥉", "4°", "5°"];
  const crear = (r, i) => {
    const c = document.createElement("div"); c.className = "st-item st" + i;
    { const lv = nivelDe(r.diamantes); if (lv >= 0) c.classList.add("lv" + lv); }   // cada uno con el fondo de su nivel
    const nombre = r.nombre || "Cliente";
    let av;
    const letra = () => { const e = document.createElement("span"); e.className = "st-av"; e.style.background = `linear-gradient(135deg,${colores[i][0]},${colores[i][1]})`; e.textContent = (nombre[0] || "C").toUpperCase(); return e; };
    if (/^https:\/\//.test(r.avatar || "")) { av = document.createElement("img"); av.className = "st-av"; av.alt = ""; av.referrerPolicy = "no-referrer"; av.src = r.avatar; av.addEventListener("error", () => av.replaceWith(letra())); }
    else av = letra();
    const m = document.createElement("span"); m.className = "st-med"; m.textContent = i < 3 ? String(i + 1) : (i + 1) + "º";
    const n = document.createElement("b"); n.className = "st-nom"; n.textContent = nombre.split(" ")[0];
    const d = document.createElement("span"); d.className = "st-dia"; d.textContent = fmtNum(r.diamantes) + " 💎";
    const nvC = nivelDe(r.diamantes);
    let ins = null;
    if (nvC >= 0) { ins = document.createElement("span"); ins.className = "st-niv n" + nvC; ins.textContent = NIVELES[nvC].ico; ins.title = "Nivel " + NIVELES[nvC].n; }
    if (i < 3) { c.append(av, m, n, d); }
    else { const tx = document.createElement("div"); tx.className = "st-tx"; const sub = document.createElement("div"); sub.className = "st-sub"; sub.append(m); if (ins) sub.appendChild(ins); sub.appendChild(d); tx.append(n, sub); c.append(av, tx); }
    if (r.es_soporte) { const t = document.createElement("i"); t.className = "st-sop"; t.textContent = "Soporte"; (i < 3 ? c : c.querySelector(".st-tx")).appendChild(t); }
    return c;
  };
  const items = data.slice(0, 5).map(crear);
  const pod = document.createElement("div"); pod.className = "st-podio";
  [1, 0, 2].forEach((k) => items[k] && pod.appendChild(items[k]));   // el 1.º va al centro
  const resto = document.createElement("div"); resto.className = "st-resto";
  items.slice(3).forEach((e) => resto.appendChild(e));
  cont.replaceChildren(pod, ...(items.length > 3 ? [resto] : []));
}
Object.assign(window, { alternarBloqueo });


// =====================================================================
// v6: niveles de cliente (umbrales editables por la administradora) y guía animada del carrusel
// =====================================================================
const NIVELES = [
  { n: "Bronce", ico: "🥉", k: "nivel_1" }, { n: "Plata", ico: "🥈", k: "nivel_2" }, { n: "Oro", ico: "🥇", k: "nivel_3" },
  { n: "Platino", ico: "💠", k: "nivel_p" }, { n: "Diamante", ico: "💎", k: "nivel_4" }, { n: "Heroico", ico: "🔥", k: "nivel_h" },
  { n: "Maestro", ico: "⚜️", k: "nivel_m" }, { n: "Leyenda", ico: "👑", k: "nivel_5" },
];
const minNivel = (i) => Number(cobro[NIVELES[i].k]) || Number(COBRO_DEF[NIVELES[i].k]);
function nivelDe(total) {
  let r = -1;
  for (let i = 0; i < NIVELES.length; i++) if ((Number(total) || 0) >= minNivel(i)) r = i;
  return r;
}
let misDiamantes = null;
async function cargarNivel() {
  if (!usuarioActual) { misDiamantes = null; pintarNivel(); return; }
  try {
    const { data, error } = await conTimeout(supabase.rpc("mis_diamantes_totales"), 8000);
    misDiamantes = !error && Number.isFinite(Number(data)) ? Number(data) : null;
  } catch (_) { misDiamantes = null; }
  pintarNivel();
}
function pintarNivel() {
  const caja = $("cu-nivel"), chip = $("sb-niv");
  try { pintarBloqueoBinance(); pintarMarcosPropios(); } catch (_) {}
  if (!usuarioActual || misDiamantes === null) { if (caja) caja.hidden = true; if (chip) chip.hidden = true; return; }
  const t = misDiamantes, i = nivelDe(t);
  const sig = i + 1 < NIVELES.length ? i + 1 : -1;
  const desde = i >= 0 ? minNivel(i) : 0;
  if (caja) {
    $("cu-niv-ico").textContent = i >= 0 ? NIVELES[i].ico : "🌱";
    $("cu-niv-nom").textContent = i >= 0 ? "Nivel " + NIVELES[i].n : "Cliente nuevo";
    $("cu-niv-total").textContent = fmtNum(t) + " 💎 recargados";
    const pct = sig < 0 ? 100 : Math.max(3, Math.min(100, ((t - desde) / (minNivel(sig) - desde)) * 100));
    $("cu-niv-fill").style.width = pct + "%";
    $("cu-niv-txt").textContent = sig < 0 ? "¡Llegaste al nivel máximo! 🎉" : `Te faltan ${fmtNum(Math.max(0, minNivel(sig) - t))} 💎 para ${NIVELES[sig].ico} ${NIVELES[sig].n}`;
    caja.hidden = false;
  }
  if (chip) { chip.textContent = i >= 0 ? NIVELES[i].ico + " " + NIVELES[i].n : "🌱 Nuevo"; chip.hidden = false; }
}
// al acreditarse una compra o iniciar sesión se actualiza el nivel
{
  const orig = avisarAcreditada;
  avisarAcreditada = function (x) { orig(x); setTimeout(cargarNivel, 1500); };
}
supabase.auth.onAuthStateChange((_e, session) => { setTimeout(cargarNivel, 150); });

// ---- Guía "Cómo cargar saldo": los pasos se pasan solos (cada 3,5 s) y se pueden frenar, ir atrás o adelante
let guiaI = 0;
function guiaMostrar(i) {
  const sl = $("slide-ayuda"); if (!sl) return;
  const pasos = sl.querySelectorAll(".sa-paso"), pts = sl.querySelectorAll(".sa-puntos i");
  guiaI = (i + pasos.length) % pasos.length;
  pasos.forEach((p, k) => p.classList.toggle("on", k === guiaI));
  pts.forEach((p, k) => p.classList.toggle("on", k === guiaI));
}
function pintarPausa() {
  $("car-pausa")?.classList.toggle("on", carruselPausado);
  const ic = $("car-pausa")?.querySelector("i"); if (ic) ic.className = "fa-solid " + (carruselPausado ? "fa-play" : "fa-pause");
  const sp = document.querySelector(".sa-pausa"); if (sp) { sp.classList.toggle("on", carruselPausado); sp.textContent = carruselPausado ? "▶ Seguir" : "⏸ Pausar"; }
}
function alternarPausa(forzar) {
  carruselPausado = typeof forzar === "boolean" ? forzar : !carruselPausado;
  pintarPausa();
}
function guiaPaso(d) { alternarPausa(true); guiaMostrar(guiaI + d); }   // si el cliente navega a mano, el carrusel se frena para que pueda leer
Object.assign(window, { alternarPausa, guiaPaso });
(function guiaCarrusel() {
  setInterval(() => {
    const sl = $("slide-ayuda"); if (!sl) return;
    if (!sl.classList.contains("active")) { if (guiaI !== 0) guiaMostrar(0); return; }
    if (carruselPausado) return;
    guiaMostrar(guiaI + 1);
  }, 3500);
  // tocar la guía la frena (celular)
  document.addEventListener("DOMContentLoaded", () => $("slide-ayuda")?.addEventListener("pointerdown", (e) => { if (e.target.closest("button")) return; alternarPausa(true); }));   // los botones (Pausar/Seguir, flechas) hacen lo suyo sin pisarse
})();

// =====================================================================
// v7: modo administrador secreto, audios en el chat y dictado por voz
// =====================================================================
const CLAVE_MODO_ADMIN = "zarela_modo_admin";
function entrarModoAdmin() {
  if (!esAdminActual()) return;
  document.body.classList.add("modo-admin");
  try { sessionStorage.setItem(CLAVE_MODO_ADMIN, "1"); } catch (_) {}
  if (opCargadas) renderOpiniones();
  if ($("sidebar-menu")?.classList.contains("open")) toggleMenu();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function salirModoAdmin() {
  if (promoModo) promoApagarAuto();
  document.body.classList.remove("modo-admin");
  try { sessionStorage.removeItem(CLAVE_MODO_ADMIN); } catch (_) {}
  if (opCargadas) renderOpiniones();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
Object.assign(window, { salirModoAdmin });
document.addEventListener("DOMContentLoaded", () => {
  $("sb-logo")?.addEventListener("click", entrarModoAdmin);   // sin ningún botón visible: es el acceso secreto
});
supabase.auth.onAuthStateChange((_e, session) => {
  setTimeout(() => {
    const admin = !!session && (session.user.email || "").toLowerCase() === CONFIG.ADMIN_EMAIL.toLowerCase();
    if (!admin) { document.body.classList.remove("modo-admin"); return; }
    try { if (sessionStorage.getItem(CLAVE_MODO_ADMIN) === "1") document.body.classList.add("modo-admin"); } catch (_) {}
    if (opCargadas) renderOpiniones();
  }, 100);
});

// ---- Grabador de audio (se usa en el chat del cliente y en el del administrador)
const esAudioRuta = (r) => /\.(webm|ogg|m4a|mp3|wav)$/i.test(String(r || "").split("?")[0]);
const MAX_AUDIO_S = 120;
function elegirMimeAudio() {
  const c = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return (window.MediaRecorder && c.find((m) => MediaRecorder.isTypeSupported(m))) || "";
}
async function grabarAudio(host, alTerminar) {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return mostrarAviso("Tu navegador no permite grabar audio.", "error");
  if (host.querySelector(".rec-bar")) return;
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (_) { return mostrarAviso("Necesitamos permiso para usar el micrófono. Activalo en tu navegador y probá de nuevo.", "error"); }
  const mime = elegirMimeAudio();
  const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const trozos = []; let cancelado = false, t0 = Date.now();
  mr.ondataavailable = (e) => { if (e.data.size) trozos.push(e.data); };
  const cerrar = () => { clearInterval(tm); stream.getTracks().forEach((t) => t.stop()); bar.remove(); };
  mr.onstop = () => {
    cerrar();
    if (cancelado || !trozos.length) return;
    const tipo = (mr.mimeType || mime || "audio/webm").split(";")[0];
    const ext = tipo.includes("mp4") ? "m4a" : tipo.includes("ogg") ? "ogg" : "webm";
    alTerminar(new Blob(trozos, { type: tipo }), ext, tipo);
  };
  const bar = document.createElement("div"); bar.className = "rec-bar";
  const dot = document.createElement("span"); dot.className = "rec-dot";
  const t = document.createElement("span"); t.className = "rec-t"; t.textContent = "0:00";
  const no = document.createElement("button"); no.type = "button"; no.className = "rec-no"; no.textContent = "✕"; no.setAttribute("aria-label", "Cancelar audio");
  const si = document.createElement("button"); si.type = "button"; si.className = "rec-si"; si.textContent = "➤"; si.setAttribute("aria-label", "Enviar audio");
  no.onclick = () => { cancelado = true; if (mr.state !== "inactive") mr.stop(); else cerrar(); };
  si.onclick = () => { if (mr.state !== "inactive") mr.stop(); };
  bar.append(dot, t, no, si);
  if (getComputedStyle(host).position === "static") host.style.position = "relative";
  host.appendChild(bar);
  const tm = setInterval(() => {
    const seg = Math.floor((Date.now() - t0) / 1000);
    t.textContent = Math.floor(seg / 60) + ":" + String(seg % 60).padStart(2, "0");
    if (seg >= MAX_AUDIO_S && mr.state !== "inactive") mr.stop();
  }, 250);
  mr.start();
}
let audioSonando = null;
const mmss = (x) => { x = Math.max(0, Math.floor(Number(x) || 0)); return Math.floor(x / 60) + ":" + String(x % 60).padStart(2, "0"); };
function nodoAudio(url, cont) {
  const w = document.createElement("div"); w.className = "wa-aud";
  const btn = document.createElement("button"); btn.type = "button"; btn.className = "wa-play"; btn.setAttribute("aria-label", "Reproducir audio");
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path class="ic-play" d="M8 5.5v13l11-6.5z" fill="currentColor"/><g class="ic-pause" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></g></svg>';
  const mid = document.createElement("div"); mid.className = "wa-mid";
  const wave = document.createElement("div"); wave.className = "wa-wave"; wave.setAttribute("role", "slider"); wave.setAttribute("aria-label", "Avance del audio"); wave.tabIndex = 0;
  let h = 7; for (const ch of url.slice(-24)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const N = 34, barras = [];
  for (let k = 0; k < N; k++) { h = (h * 1103515245 + 12345) >>> 0; const v = 0.22 + ((h >>> 8) % 100) / 100 * 0.78; const b = document.createElement("i"); b.style.height = Math.round(v * 100) + "%"; wave.appendChild(b); barras.push(b); }
  const meta = document.createElement("div"); meta.className = "wa-meta";
  const tiempo = document.createElement("span"); tiempo.textContent = "0:00";
  const vel = document.createElement("button"); vel.type = "button"; vel.className = "wa-vel"; vel.textContent = "1×"; vel.setAttribute("aria-label", "Cambiar velocidad");
  meta.append(tiempo, vel); mid.append(wave, meta); w.append(btn, mid);

  const a = new Audio(); a.preload = "metadata"; a.src = url;
  const total = () => (Number.isFinite(a.duration) ? a.duration : 0);
  const pintar = () => {
    const d = total(), c = a.currentTime || 0, p = d ? c / d : 0;
    const on = Math.round(p * N);
    barras.forEach((b, k) => b.classList.toggle("on", k < on));
    tiempo.textContent = w.classList.contains("on") || c > 0.1 ? mmss(c) : mmss(d);
    wave.setAttribute("aria-valuenow", String(Math.round(p * 100)));
  };
  a.addEventListener("loadedmetadata", () => {
    if (a.duration === Infinity) {   // los audios grabados en el navegador no traen la duración: se calcula una vez
      const f = () => { a.removeEventListener("timeupdate", f); a.currentTime = 0; pintar(); seguirAbajo(cont); };
      a.addEventListener("timeupdate", f); a.currentTime = 1e101;
    } else { pintar(); seguirAbajo(cont); }
  });
  a.addEventListener("timeupdate", pintar);
  a.addEventListener("play", () => { w.classList.add("on"); btn.setAttribute("aria-label", "Pausar audio"); });
  a.addEventListener("pause", () => { w.classList.remove("on"); btn.setAttribute("aria-label", "Reproducir audio"); pintar(); });
  a.addEventListener("ended", () => { w.classList.remove("on"); a.currentTime = 0; pintar(); });
  a.addEventListener("error", () => { w.classList.add("roto"); tiempo.textContent = "No se pudo reproducir"; });
  btn.addEventListener("click", () => {
    if (a.paused) { if (audioSonando && audioSonando !== a) audioSonando.pause(); audioSonando = a; a.play().catch(() => {}); } else a.pause();
  });
  const velocidades = [1, 1.5, 2]; let vi = 0;
  vel.addEventListener("click", () => { vi = (vi + 1) % velocidades.length; a.playbackRate = velocidades[vi]; vel.textContent = String(velocidades[vi]).replace(".", ",") + "×"; });
  const buscar = (e) => { const r = wave.getBoundingClientRect(); const d = total(); if (!d) return; a.currentTime = Math.min(d, Math.max(0, ((e.clientX - r.left) / r.width) * d)); pintar(); };
  let arrastra = false;
  wave.addEventListener("pointerdown", (e) => { arrastra = true; wave.setPointerCapture(e.pointerId); buscar(e); });
  wave.addEventListener("pointermove", (e) => { if (arrastra) buscar(e); });
  wave.addEventListener("pointerup", () => { arrastra = false; });
  wave.addEventListener("keydown", (e) => { if (e.key === "ArrowRight") a.currentTime = Math.min(total(), a.currentTime + 5); else if (e.key === "ArrowLeft") a.currentTime = Math.max(0, a.currentTime - 5); else return; e.preventDefault(); pintar(); });
  return w;
}

// Cliente: botón de micrófono junto a enviar
async function enviarAudioCliente(blob, ext, tipo) {
  if (!usuarioActual) return mostrarAviso("Iniciá sesión con Google para enviar audios.", "error");
  if (blob.size > CONFIG.MAX_ARCHIVO_MB * 1024 * 1024) return mostrarAviso("El audio es muy largo. Probá con uno más corto.", "error");
  try {
    const ruta = `${usuarioActual.id}/${Date.now()}.${ext}`;
    const { error: e1 } = await supabase.storage.from(CONFIG.BUCKET_COMPROBANTES).upload(ruta, blob, { contentType: tipo, upsert: false });
    if (e1) throw e1;
    const nuevo = { [MSG.userCol]: usuarioActual.id, [MSG.senderCol]: usuarioActual.id, [MSG.textoCol]: "", [MSG.archivoCol]: ruta, [MSG.leidoCol]: false };
    const { error } = await supabase.from(MSG.tabla).insert(nuevo);
    if (error) throw error;
    await cargarHistorialCliente(true);
    irAlFinal($("chat-messages-container"));
    notificarChatN8n("🎤 Mensaje de voz", ruta, "audio." + ext).catch(() => {});
  } catch (err) {
    console.error("Audio:", err);
    mostrarAviso(/mime|not supported|invalid/i.test(String(err.message || "")) ? "Falta habilitar los audios: ejecutá novedades_clientes_v7.sql." : "No se pudo enviar el audio. Reintentá.", "error");
  }
}
document.addEventListener("DOMContentLoaded", () => {
  const inp = $("chat-user-input"); if (!inp) return;
  const fila = inp.parentElement;
  const mic = document.createElement("button"); mic.type = "button"; mic.className = "btn-attach btn-mic"; mic.title = "Enviar un audio"; mic.setAttribute("aria-label", "Grabar y enviar un audio");
  mic.innerHTML = '<i class="fa-solid fa-microphone"></i>';
  mic.addEventListener("click", () => {
    if (!usuarioActual) { mostrarAviso("Iniciá sesión con Google para enviar audios.", "error"); if (!$("sidebar-menu")?.classList.contains("open")) toggleMenu(); return; }
    grabarAudio(fila, enviarAudioCliente);
  });
  const enviar = fila.querySelector(".btn-send"); fila.insertBefore(mic, enviar);
});

// Administrador: audio y dictado en la caja de respuesta
async function enviarAudioAdmin(blob, ext, tipo, sel) {
  try {
    const ruta = `${sel.id}/adm_${Date.now()}.${ext}`;
    const { error: e1 } = await supabase.storage.from(CONFIG.BUCKET_COMPROBANTES).upload(ruta, blob, { contentType: tipo, upsert: false });
    if (e1) throw e1;
    const fila = { [MSG.userCol]: sel.id, [MSG.senderCol]: usuarioActual.id, [MSG.textoCol]: "", [MSG.archivoCol]: ruta, [MSG.leidoCol]: false };
    const { error } = await supabase.from(MSG.tabla).insert(fila);
    if (error) throw error;
    tocarActividad(sel.id);
    await refrescarMensajes(true);
  } catch (err) {
    console.error("Audio admin:", err);
    mostrarAviso("No se pudo enviar el audio. ¿Ejecutaste novedades_clientes_v7.sql?", "error");
  }
}
function dictadoAdmin(btn, inp) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return mostrarAviso("El dictado funciona en Google Chrome o Edge.", "error");
  if (btn._rec) { btn._rec.stop(); return; }
  const rec = new SR(); rec.lang = "es-AR"; rec.continuous = true; rec.interimResults = true;
  const base = inp.value ? inp.value.replace(/\s*$/, " ") : "";
  let fijo = "";
  rec.onresult = (e) => {
    let prov = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const tx = e.results[i][0].transcript;
      if (e.results[i].isFinal) fijo += tx; else prov += tx;
    }
    inp.value = (base + fijo + prov).slice(0, 1000);
  };
  rec.onend = () => { btn._rec = null; btn.classList.remove("escuchando"); btn.textContent = "🗣️ Dictar"; inp.focus(); };
  rec.onerror = (e) => { if (e.error === "not-allowed") mostrarAviso("Permití el micrófono para dictar.", "error"); };
  btn._rec = rec; btn.classList.add("escuchando"); btn.textContent = "⏹ Parar";
  rec.start();
}
const _construirVista = construirVistaCliente;
construirVistaCliente = function () {
  _construirVista();
  const resp = document.querySelector("#admin-chat-view .adm-resp"); if (!resp) return;
  const inp = $("admin-respuesta"), sel = clienteSel;
  const aud = creaBoton("🎙️", "background:#1d2740;color:#7dd3fc;border:1px solid #3f557f;");
  aud.classList.add("adm-mic"); aud.title = "Grabar y enviar un audio";
  aud.addEventListener("click", () => grabarAudio(resp, (b, ext, tipo) => enviarAudioAdmin(b, ext, tipo, sel)));
  const dic = creaBoton("🗣️ Dictar", "background:#1d2740;color:#7dd3fc;border:1px solid #3f557f;");
  dic.classList.add("adm-mic"); dic.title = "Hablá y se escribe";
  dic.addEventListener("click", () => dictadoAdmin(dic, inp));
  resp.insertBefore(dic, resp.firstChild); resp.insertBefore(aud, resp.firstChild);
};


// =====================================================================
// v8: insignias y marcos por nivel, bloqueo de precios Binance, opciones de admin solo en modo admin
// =====================================================================
const adminVisible = () => esAdminActual() && document.body.classList.contains("modo-admin");

// ---- Nivel de cada cliente (para insignias y marcos en comentarios)
let nivelesUsr = {};
async function cargarNivelesUsuarios() {
  const ids = [...new Set([...opiniones.map((o) => o.user_id), ...respuestas.map((r) => r.user_id)].filter(Boolean))].slice(0, 400);
  if (!ids.length) return;
  try {
    const { data, error } = await conTimeout(supabase.rpc("niveles_de_usuarios", { p_ids: ids }), 8000);
    if (!error && Array.isArray(data)) { nivelesUsr = {}; data.forEach((r) => { nivelesUsr[r.user_id] = Number(r.diamantes) || 0; }); }
  } catch (_) { /* sin insignias hasta que se ejecute novedades_clientes_v8.sql */ }
}
function nivelDeUsuario(uid) {
  try {
    if (usuarioActual && uid === usuarioActual.id && misDiamantes !== null) return nivelDe(misDiamantes);
    return uid in nivelesUsr ? nivelDe(nivelesUsr[uid]) : -1;
  } catch (_) { return -1; }
}
// v58 · datos públicos actuales (nombre, foto, ✔) de cualquier persona
const perfPub = {}, verifUsr = new Set();
async function cargarPublicos(ids, forzar) {
  ids = [...new Set((ids || []).filter(Boolean))].filter((u) => forzar || !(u in perfPub)).slice(0, 300);
  if (!ids.length) return;
  try {
    const { data, error } = await conTimeout(supabase.rpc("perfiles_publicos", { p_ids: ids }), 7000);
    if (error) throw error;
    (data || []).forEach((r) => { perfPub[r.id] = r; if (r.verificado || r.es_soporte) verifUsr.add(r.id); else verifUsr.delete(r.id); });
  } catch (_) { /* hasta que se ejecute novedades_clientes_v43.sql */ }
}
function miniAv(nombre, foto, cls) {
  const a = document.createElement("span"); a.className = "mini-av " + (cls || "");
  const ini = () => { a.textContent = (nombre || "?").trim().charAt(0).toUpperCase(); };
  if (foto && /^https:\/\//.test(foto)) { const im = document.createElement("img"); im.alt = ""; im.referrerPolicy = "no-referrer"; im.onerror = () => { im.remove(); ini(); }; im.src = foto; a.appendChild(im); } else ini();
  return a;
}
function selloVerif() { const v = document.createElement("span"); v.className = "vf"; v.title = "Cuenta verificada"; v.textContent = "✔"; return v; }
// banner sutil que va desde la foto hasta el final del nombre (+ ✔ si está verificada)
function conBanner(nodoNombre, uid, conEtiqueta = true) {
  const i = nivelDeUsuario(uid), vf = !!uid && verifUsr.has(uid);
  if (i < 0 && !vf) return nodoNombre;
  const w = document.createElement("span");
  if (i >= 0) { w.className = "nvb nvb-" + i; w.title = "Nivel " + NIVELES[i].n; } else w.className = "nvb-vf";
  w.appendChild(nodoNombre);
  if (vf) w.appendChild(selloVerif());
  if (i >= 0) {
    const ic = document.createElement("span"); ic.className = "nvb-ico"; ic.textContent = NIVELES[i].ico; w.appendChild(ic);
    if (conEtiqueta) { const t = document.createElement("span"); t.className = "nvb-t"; t.textContent = NIVELES[i].n; w.appendChild(t); }
  }
  return w;
}
function insigniaNivel(uid) {
  const i = nivelDeUsuario(uid);
  if (i < 0) return null;
  const b = document.createElement("span");
  b.className = "niv-ins n" + i; b.title = "Nivel " + NIVELES[i].n + " · cliente que recargó " + fmtNum(Math.max(minNivel(i), 0)) + "+ 💎";
  b.textContent = NIVELES[i].ico + " " + NIVELES[i].n;
  return b;
}

// ---- Marco animado alrededor de un avatar (más brillante cuanto más alto el nivel)
const CHISPAS = [0, 0, 2, 3, 4];
function enmarcar(el) { return el; }   // sin aro: el nivel se muestra con un banner junto al nombre
// mi perfil (tarjeta de cuenta y menú lateral): marco + banner según mi nivel
function pintarMarcosPropios() {
  const i = usuarioActual && misDiamantes !== null ? nivelDe(misDiamantes) : -1;
  const per = document.querySelector(".cu-perfil");
  if (per) per.className = "cu-perfil" + (i >= 0 ? " nv-" + i : "");
  const sbp = $("sb-perfil");
  if (sbp) { sbp.classList.remove("nv-0", "nv-1", "nv-2", "nv-3", "nv-4", "nv-5", "nv-6", "nv-7"); if (i >= 0) sbp.classList.add("nv-" + i); }
}

// ---- Precios Binance bloqueados hasta recargar el mínimo
const binMin = () => Number(cobro.binance_min) || Number(COBRO_DEF.binance_min);
function binanceBloqueado() {
  if (esAdminActual()) return false;
  return (misDiamantes === null ? 0 : misDiamantes) < binMin();
}
function pintarBloqueoBinance() {
  const aviso = $("bn-lock"), cajas = $("grid-binance-cajas");
  if (!aviso || !cajas) return;
  const bloq = binanceBloqueado(), t = misDiamantes === null ? 0 : misDiamantes, min = binMin();
  cajas.classList.toggle("bloqueada", bloq);
  if (bloq) cajas.setAttribute("inert", ""); else cajas.removeAttribute("inert");
  cajas.setAttribute("aria-disabled", String(bloq));
  aviso.hidden = false; aviso.classList.toggle("ok", !bloq);
  $("bn-lock-ico").textContent = bloq ? "🔒" : "✅";
  $("bn-lock-tit").textContent = bloq ? "Mejores precios bloqueados" : (esAdminActual() ? "Precios desbloqueados (administradora)" : "¡Mejores precios desbloqueados!");
  $("bn-lock-txt").textContent = bloq
    ? (usuarioActual
        ? `Se desbloquean al recargar ${fmtNum(min)} 💎 en total. Llevás ${fmtNum(t)} 💎: te faltan ${fmtNum(Math.max(0, min - t))}. Mientras tanto podés comprar en Mercado Pago.`
        : `Se desbloquean al recargar ${fmtNum(min)} 💎 en total. Iniciá sesión para ver cuánto llevás. Mientras tanto podés comprar en Mercado Pago.`)
    : "Ya podés comprar con los precios Binance.";
  $("bn-lock-fill").style.width = (bloq ? Math.max(2, Math.min(100, (t / min) * 100)) : 100) + "%";
}
document.addEventListener("DOMContentLoaded", () => { pintarBloqueoBinance(); });
supabase.auth.onAuthStateChange(() => { setTimeout(() => { try { pintarBloqueoBinance(); pintarMarcosPropios(); } catch (_) {} }, 400); });


// =====================================================================
// v9: precios de los paquetes editables, equivalente en pesos bajo los precios Binance
// =====================================================================
let precios = {};   // id -> { usd, ars, dia }
const cajasPaquetes = () => [...document.querySelectorAll(".diamond-box")].map((c) => {
  const m = /comprarPaquete\(event,\s*'([^']+)',\s*'(ARS|USD)'/.exec(c.querySelector(".btn-buy")?.getAttribute("onclick") || "");
  return m ? { c, id: m[1], mon: m[2] } : null;
}).filter(Boolean);
const tasaArs = () => Number(cobro.tasa_ars_usd) || Number(COBRO_DEF.tasa_ars_usd);
const fmtUsdPrecio = (n) => "USD " + Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const arsDeUsd = (usd) => Math.round(Number(usd) * tasaArs());
function pintarPrecios() {
  cajasPaquetes().forEach(({ c, id, mon }) => {
    const p = precios[id], el = c.querySelector(".price");
    if (!el) return;
    if (mon === "ARS") { if (p && p.ars != null) el.textContent = "ARS " + formatoARS(p.ars); return; }
    if (p && p.usd != null) el.textContent = fmtUsdPrecio(p.usd);
    const usd = p && p.usd != null ? Number(p.usd) : precioDeCaja(c);
    let eq = c.querySelector(".precio-ars");
    if (!eq) { eq = document.createElement("p"); eq.className = "precio-ars"; el.insertAdjacentElement("afterend", eq); }
    eq.textContent = usd ? "≈ " + formatoARS(arsDeUsd(usd)) + " ARS" : "";
  });
}
async function cargarPrecios() {
  try {
    const { data, error } = await conTimeout(supabase.rpc("precios_paquetes"), 8000);
    if (!error && Array.isArray(data) && data.length) {
      precios = {}; data.forEach((r) => { precios[r.id] = { usd: Number(r.precio_usd), ars: r.precio_ars == null ? null : Number(r.precio_ars), dia: Number(r.diamantes) }; });
    }
  } catch (_) { /* quedan los precios escritos en la página */ }
  pintarPrecios(); rellenarPreciosAdmin();
}
// editor del panel
function rellenarPreciosAdmin() {
  const host = $("precios-admin"); if (!host) return;
  const enPagina = new Set(cajasPaquetes().map((x) => x.id));
  const ids = Object.keys(precios).filter((id) => enPagina.has(id));   // solo los paquetes que se venden en la página
  if (!ids.length) { host.innerHTML = '<p class="pa-vacio">Todavía no se pueden editar los precios: ejecutá <b>novedades_clientes_v9.sql</b> en Supabase.</p>'; return; }
  const tasa = () => Number($("cobro-tasa_ars_usd")?.value) || tasaArs();
  host.replaceChildren();
  const cab = document.createElement("div"); cab.className = "pa-fila pa-cab";
  cab.innerHTML = "<span>Paquete</span><span>Mercado Pago · $ ARS</span><span>Binance · US$</span>";
  host.appendChild(cab);
  ids.forEach((id) => {
    const p = precios[id];
    const f = document.createElement("div"); f.className = "pa-fila"; f.dataset.id = id;
    const n = document.createElement("b"); n.textContent = fmtNum(p.dia) + " 💎";
    const la = document.createElement("label");
    const ia = document.createElement("input"); ia.type = "number"; ia.min = "1"; ia.step = "1"; ia.inputMode = "numeric"; ia.className = "pa-ars"; ia.value = p.ars == null ? "" : String(Math.round(p.ars)); la.appendChild(ia);
    const lu = document.createElement("label");
    const iu = document.createElement("input"); iu.type = "number"; iu.min = "0.01"; iu.step = "0.01"; iu.inputMode = "decimal"; iu.className = "pa-usd"; iu.value = String(p.usd); lu.appendChild(iu);
    const eq = document.createElement("span"); eq.className = "pa-eq";
    const act = () => { const u = Number(iu.value); eq.textContent = u > 0 ? "= " + formatoARS(Math.round(u * tasa())) + " ARS" : "—"; };
    iu.addEventListener("input", act); $("cobro-tasa_ars_usd")?.addEventListener("input", act); act();
    lu.appendChild(eq); f.append(n, la, lu); host.appendChild(f);
  });
}
async function guardarPrecios() {
  let n = 0;
  for (const f of document.querySelectorAll("#precios-admin .pa-fila[data-id]")) {
    const id = f.dataset.id, p = precios[id]; if (!p) continue;
    const ars = Math.round(Number(f.querySelector(".pa-ars").value)), usd = Math.round(Number(f.querySelector(".pa-usd").value) * 100) / 100;
    if (!(ars > 0) || !(usd > 0)) { mostrarAviso("Los precios de " + fmtNum(p.dia) + " 💎 tienen que ser números mayores a 0.", "error"); return false; }
    if (ars === Math.round(p.ars || 0) && usd === p.usd) continue;
    const { error } = await supabase.rpc("admin_guardar_precio", { p_id: id, p_usd: usd, p_ars: ars });
    if (error) { mostrarAviso(/NO_AUTORIZADO/.test(error.message) ? "No tenés permiso para cambiar precios." : "No se pudo guardar el precio. ¿Ejecutaste novedades_clientes_v9.sql?", "error"); return false; }
    precios[id] = { ...p, usd, ars }; n++;
  }
  if (n) pintarPrecios();
  return n;
}
document.addEventListener("DOMContentLoaded", () => { pintarPrecios(); cargarPrecios(); });


// =====================================================================
// v10: avisos con sonido propio (chime Zarela), lista de 8 chats y menú ⋮ del chat
// =====================================================================
// ---- Sonido: se genera en el momento (no hace falta ningún archivo)
let pushActivo = false;   // true si este dispositivo ya recibe push (entonces no duplicamos con avisos locales)
const avisosOn = () => { try { return localStorage.getItem("zarela_avisos") !== "0"; } catch (_) { return true; } };
let ctxAudio = null;
const abrirCtxAudio = () => { try { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctxAudio = ctxAudio || new C(); if (ctxAudio.state === "suspended") ctxAudio.resume(); return ctxAudio; } catch (_) { return null; } };
["pointerdown", "keydown", "touchstart"].forEach((ev) => document.addEventListener(ev, () => abrirCtxAudio(), { once: true, passive: true }));
function sonidoZarela(forzar) {
  if (!forzar && !avisosOn()) return;
  const c = abrirCtxAudio(); if (!c) return;
  const t0 = c.currentTime + 0.03;
  // campanita en 3 notas que suben (mi – sol# – si – mi agudo), suave y breve
  [[659.25, 0, 0.55], [830.61, 0.10, 0.55], [987.77, 0.20, 0.6], [1318.51, 0.31, 1.1]].forEach(([f, dt, dur]) => {
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0 + dt);
    g.gain.exponentialRampToValueAtTime(0.22, t0 + dt + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + dur);
    const o1 = c.createOscillator(); o1.type = "sine"; o1.frequency.value = f;
    const o2 = c.createOscillator(); o2.type = "triangle"; o2.frequency.value = f * 2; const g2 = c.createGain(); g2.gain.value = 0.18;
    o1.connect(g); o2.connect(g2); g2.connect(g); g.connect(c.destination);
    o1.start(t0 + dt); o2.start(t0 + dt); o1.stop(t0 + dt + dur + 0.05); o2.stop(t0 + dt + dur + 0.05);
  });
}
function avisar(titulo, texto, { toast = true, tipo = "ok" } = {}) {
  sonidoZarela();
  try { navigator.vibrate && navigator.vibrate([220, 90, 220, 90, 320]); } catch (_) {}
  if (toast && !document.hidden) mostrarAviso(titulo + (texto ? " " + texto : ""), tipo);
  if (document.hidden && avisosOn()) {
    try { if (!pushActivo && "Notification" in window && Notification.permission === "granted") new Notification(titulo, { body: texto || "", tag: "zarela-aviso", vibrate: [220, 90, 220, 90, 320], renotify: true }); } catch (_) {}
  }
}
// botón del menú lateral
const permisoAvisos = () => ("Notification" in window ? Notification.permission : "unsupported");
const avisosActivos = () => avisosOn() && permisoAvisos() === "granted";
function pintarBotonAvisos() {
  const perm = permisoAvisos(), act = avisosActivos();
  const titulo = act ? "Avisos activados" : perm === "denied" ? "Avisos bloqueados" : perm === "unsupported" ? "Avisos no disponibles" : "Activar avisos";
  const sub = act ? "Te avisamos cuando se acredite tu recarga o te escriba soporte, aunque la página esté cerrada."
    : perm === "denied" ? "Tu navegador los bloqueó: tocá el candado de la barra de direcciones y permití las notificaciones."
    : perm === "unsupported" ? "Este navegador no permite notificaciones. Probá con Chrome." : "Tocá para recibir un aviso cuando se acredite tu recarga o te escriba soporte.";
  const b = $("sb-avisos");
  if (b) { b.classList.toggle("off", !act); b.querySelector("b").textContent = titulo; { const sm = b.querySelector("small"); sm.textContent = ""; if (act) { const o = document.createElement("span"); o.className = "sb-okv"; o.textContent = "✓ Activados"; sm.append(o, " · "); } sm.append(sub); } b.querySelector(".sb-ico").textContent = act ? "🔔" : perm === "denied" ? "🚫" : "🔕"; }
  const t = $("camp-top");
  if (t) { t.classList.toggle("off", !act); t.classList.toggle("bloq", perm === "denied"); t.title = titulo; t.setAttribute("aria-label", titulo); t.querySelector("i").className = "fa-solid " + (act ? "fa-bell" : perm === "denied" ? "fa-bell-slash" : "fa-bell-slash"); t.querySelector("span").textContent = act ? "Avisos" : perm === "denied" ? "Bloqueados" : "Activar"; }
}
async function alternarAvisos() {
  const perm = permisoAvisos();
  if (perm === "unsupported" || perm === "denied") { mostrarAviso(perm === "denied" ? "Tenés los avisos bloqueados en el navegador. Tocá el candado junto a la dirección y permití las notificaciones." : "Este navegador no permite notificaciones.", "error"); pintarBotonAvisos(); return; }
  if (avisosActivos()) {   // estaba activo → apagar
    try { localStorage.setItem("zarela_avisos", "0"); } catch (_) {}
    desuscribirPush(); pintarBotonAvisos(); mostrarAviso("Avisos apagados.", "ok"); return;
  }
  try { localStorage.setItem("zarela_avisos", "1"); } catch (_) {}
  sonidoZarela(true);
  try { if (Notification.permission === "default") await Notification.requestPermission(); } catch (_) {}
  pintarBotonAvisos();
  if (Notification.permission === "granted") {
    const ok = await registrarPush(true); pintarBotonAvisos();
    mostrarAviso(ok ? "Avisos activados. Así suena. 🔔" : "Avisos activados en esta página.", "ok");
  } else mostrarAviso("No diste permiso: los avisos siguen apagados.", "error");
}
Object.assign(window, { alternarAvisos });
document.addEventListener("DOMContentLoaded", () => { pintarBotonAvisos(); $("sb-avisos")?.addEventListener("click", alternarAvisos); $("camp-top")?.addEventListener("click", alternarAvisos); });
try { navigator.permissions?.query({ name: "notifications" }).then((r) => { r.onchange = () => pintarBotonAvisos(); }); } catch (_) {}

// acreditación de recarga
{
  const prev = avisarAcreditada;
  avisarAcreditada = function (x) { prev(x); sonidoZarela(); };
}
// mensaje nuevo de soporte
let ultimoAvisoMsg = null;
function avisoMensajeNuevo(nuevos, ultimo) {
  const ts = ultimo ? String(ultimo[MSG.fechaCol] || "") : "";
  if (ultimoAvisoMsg === null) { ultimoAvisoMsg = ts; return; }   // la primera lectura no suena
  if (!nuevos || ts === ultimoAvisoMsg) return;
  ultimoAvisoMsg = ts;
  if (ultimo && /^💰 ¡Te acreditamos saldo/.test(String(ultimo[MSG.textoCol] || ""))) return;   // ese ya lo avisa el saldo (una sola notificación)
  const t = ultimo && ultimo[MSG.textoCol] ? String(ultimo[MSG.textoCol]).slice(0, 80) : "Te mandó un mensaje";
  avisar("💬 Soporte Zarela:", t, { tipo: "info" });
}
// saldo acreditado (por la administradora, devolución, etc.)
let saldoBase = null, saldoBaseUid = null;
{
  const orig = cargarSaldo;
  cargarSaldo = async function (user) {
    await orig(user);
    try {
      if (!user || esAdminActual()) return;
      if (!saldoLeidoOk) return;   // la lectura falló (red, sesión sin cargar): no se compara contra un 0 falso
      if (saldoBaseUid !== user.id) { saldoBaseUid = user.id; saldoBase = { ...saldos }; return; }
      const sube = (saldos.USD - saldoBase.USD) > 0.005, subeARS = (saldos.ARS - saldoBase.ARS) >= 1;
      const bajaUno = (saldos.USD < saldoBase.USD - 0.005) || (saldos.ARS < saldoBase.ARS - 0.5);   // conversión o compra: no es un "regalo"
      if ((sube || subeARS) && !bajaUno) {
        const partes = [];
        if (subeARS) partes.push("+" + formatoARS(saldos.ARS - saldoBase.ARS) + " ARS");
        if (sube) partes.push("+" + formatoUSD(saldos.USD - saldoBase.USD) + " USD");
        // no repetir el mismo aviso (recargas de página, varias pestañas)
        const firma = "zarela_aviso_saldo_" + user.id, valor = saldos.ARS + "|" + saldos.USD;
        let igual = false;
        try { igual = localStorage.getItem(firma) === valor; localStorage.setItem(firma, valor); } catch (_) {}
        if (!igual) avisar("💰 ¡Te acreditamos saldo!", partes.join(" · "));
      }
      saldoBase = { ...saldos };
    } catch (_) {}
  };
  setInterval(() => { if (!document.hidden && usuarioActual && !esAdminActual()) cargarSaldo(usuarioActual); }, 5000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && usuarioActual && !esAdminActual()) cargarSaldo(usuarioActual); });
  addEventListener("focus", () => { if (usuarioActual && !esAdminActual()) cargarSaldo(usuarioActual); });
}

// ---- Lista de chats del panel: se ven 8 y el resto con scroll
function ajustarListaClientes() {
  const l = $("admin-users-list"); if (!l) return;
  if (!window.matchMedia("(max-width: 800px)").matches) { l.style.maxHeight = ""; return; }   // PC: la altura la fija el panel
  const it = [...l.children].filter((e) => e.tagName === "BUTTON");
  if (it.length > 8) l.style.maxHeight = (it[8].offsetTop - it[0].offsetTop + 10) + "px"; else l.style.maxHeight = "";
}
{
  const prev = renderListaClientes;
  renderListaClientes = function () { prev(); try { ajustarListaClientes(); } catch (_) {} };
}
window.addEventListener("resize", () => { try { ajustarListaClientes(); } catch (_) {} });

// ---- Menú ⋮ del chat del cliente (estilo WhatsApp): todo lo extra queda escondido hasta que lo elegís
function armarMenuChat() {
  const vista = $("admin-chat-view"); const cab = vista?.querySelector(".adm-cab"); if (!cab || cab.dataset.menu) return;
  cab.dataset.menu = "1";
  const uid = clienteSel.id;
  const atras = cab.querySelector(".adm-atras"), nombre = cab.querySelector("strong"), sub = cab.querySelector("div");
  const botones = [...cab.querySelectorAll(":scope > button")].filter((b) => b !== atras);
  const verOrdenes = botones[0], btnBloq = botones[1];
  if (sub) sub.textContent = clienteSel?.email && clienteSel.email !== "-" ? clienteSel.email : "";
  const det = [...vista.children].find((e) => e.tagName === "DETAILS");
  const tog = vista.querySelector('button[aria-controls="admin-caja-saldo"]'), caja = $("admin-caja-saldo");
  const buscar = [...vista.children].find((e) => e.matches && e.matches("label.adm-buscar"));
  const ocultar = (e) => { if (e) e.classList.add("adm-ex"); };
  [det, tog, caja, buscar].forEach(ocultar);
  if (tog) tog.style.display = "none";

  const titulo = document.createElement("div"); titulo.className = "adm-cab-t"; titulo.append(nombre, sub);
  const puntos = document.createElement("button"); puntos.type = "button"; puntos.className = "adm-puntos"; puntos.setAttribute("aria-label", "Más opciones"); puntos.innerHTML = '<i class="fa-solid fa-ellipsis-vertical"></i>';
  const pin = document.createElement("button"); pin.type = "button"; pin.className = "adm-puntos adm-pin"; pin.textContent = "📌";
  const pintarPin = () => { const on = chatFijado === uid; pin.classList.toggle("on", on); pin.title = on ? "Chat fijado: no se cierra al cambiar de sala (tocá para soltarlo)" : "Fijar este chat: no se cierra al cambiar de sala"; pin.setAttribute("aria-label", pin.title); pin.setAttribute("aria-pressed", String(on)); };
  pin.addEventListener("click", (e) => { e.stopPropagation(); chatFijado = chatFijado === uid ? null : uid; pintarPin(); mostrarAviso(chatFijado === uid ? "Chat fijado: queda abierto aunque cambies de sala." : "Chat suelto: se cierra si cambiás a una sala donde no está.", "ok"); });
  pintarPin();
  const menu = document.createElement("div"); menu.className = "adm-menu"; menu.hidden = true;
  const actualizadores = [];
  const item = (ico, txt, fn, nodo) => { const b = nodo || document.createElement("button"); b.type = "button"; b.className = "adm-mi"; b.removeAttribute("style"); if (!nodo) b.innerHTML = `<span>${ico}</span><b>${txt}</b>`; b.addEventListener("click", () => { menu.hidden = true; fn(); }); menu.appendChild(b); return b; };
  const sep = () => { const d = document.createElement("div"); d.className = "adm-sep"; menu.appendChild(d); };
  const verPanel = (nodos, enfocar) => {
    const abrirYa = nodos.some((n) => n.classList.contains("adm-ex"));
    [det, caja, buscar].forEach(ocultar);
    if (abrirYa) nodos.forEach((n) => { n.classList.remove("adm-ex"); if (n === caja) n.hidden = false; });
    if (det) det.open = abrirYa && nodos.includes(det);
    if (abrirYa && enfocar) setTimeout(() => enfocar.focus(), 50);
  };
  item("🪟", chatFlota ? "Devolver el chat a su lugar" : "Sacar el chat afuera (burbuja)", () => { chatFlota ? flotaDevolver() : flotaSacar(); });
  item("✖️", "Cerrar chat", () => cerrarChatActual());
  const bArch = item("🗄️", "", () => { const m = metaDe(uid); guardarMeta(uid, { archivado: !m.archivado }); if (!m.archivado) cerrarChatActual(); });
  actualizadores.push(() => { bArch.querySelector("b").textContent = metaDe(uid).archivado ? "Sacar de archivados" : "Archivar chat"; bArch.firstElementChild.textContent = metaDe(uid).archivado ? "📤" : "🗄️"; });
  [1, 2, 3].forEach((n) => {
    const b = item("🎮", "", () => { const m = metaDe(uid); const sa = m.salas.includes(n) ? m.salas.filter((x) => x !== n) : [...m.salas, n].sort(); guardarMeta(uid, { salas: sa }); mostrarAviso(sa.includes(n) ? `Agregado a la Sala ${n}.` : `Quitado de la Sala ${n}.`, "ok"); });
    actualizadores.push(() => { const en = metaDe(uid).salas.includes(n); b.querySelector("b").textContent = (en ? "Quitar de Sala " : "Mandar a Sala ") + n; b.classList.toggle("en-sala", en); });
  });
  sep();
  if (caja) item("💰", "Saldos y acreditar", () => verPanel([caja]));
  if (verOrdenes) { verOrdenes.innerHTML = "<span>🧾</span><b>Ver sus órdenes</b>"; item("", "", () => {}, verOrdenes); }
  if (btnBloq) {
    item("", "", () => {}, btnBloq);
    const pint = () => { const [ico, ...r] = btnBloq.textContent.trim().split(" "); btnBloq.innerHTML = `<span>${ico}</span><b>${r.join(" ")}</b>`; };
    pint(); new MutationObserver(() => { if (btnBloq.firstElementChild?.tagName !== "SPAN") pint(); }).observe(btnBloq, { childList: true, characterData: true, subtree: false });
  }
  if (det) item("📒", "Movimientos de saldo", () => verPanel([det]));
  const lupa = document.createElement("button"); lupa.type = "button"; lupa.className = "adm-puntos adm-lupa"; lupa.textContent = "🔍"; lupa.title = "Buscar en la conversación"; lupa.setAttribute("aria-label", "Buscar en la conversación");
  lupa.addEventListener("click", (e) => { e.stopPropagation(); if (buscar) verPanel([buscar], buscar.querySelector("input")); });
  const refrescar = () => actualizadores.forEach((f) => f());
  refrescar();
  puntos.addEventListener("click", (e) => { e.stopPropagation(); refrescar(); menu.hidden = !menu.hidden; });
  document.addEventListener("click", (e) => { if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true; });
  cab.replaceChildren(...[atras, titulo, lupa, pin, puntos, menu].filter(Boolean));
  cab.classList.add("adm-cab-v2");
}

{
  const prev = construirVistaCliente;
  construirVistaCliente = function () { prev(); try { armarMenuChat(); } catch (e) { console.warn("menú del chat:", e); } };
}


// =====================================================================
// v10: cerrar chat, archivados y salas (Sala 1, 2 y 3) + "Todas las salas" con aviso masivo
// =====================================================================
const CLAVE_META = "zarela_chat_meta";
let chatMeta = new Map(), metaEnBase = true, metaAvisada = false;
const metaDe = (uid) => { const m = chatMeta.get(uid) || {}; return { archivado: !!m.archivado, salas: m.salas || [], hist: m.hist || [], ultima: m.ultima || null }; };
function leerMetaLocal() { try { return JSON.parse(localStorage.getItem(CLAVE_META) || "{}"); } catch (_) { return {}; } }
function escribirMetaLocal() {
  const o = {}; chatMeta.forEach((v, k) => { if (v.archivado || (v.salas || []).length || (v.hist || []).length) o[k] = v; });
  try { localStorage.setItem(CLAVE_META, JSON.stringify(o)); } catch (_) {}
}
async function cargarChatMeta() {
  if (!esAdminActual()) return;
  const local = leerMetaLocal();
  chatMeta = new Map(Object.entries(local));
  try {
    const { data, error } = await conTimeout(supabase.from("admin_chat_meta").select("user_id, archivado, salas, jugo_salas, ultima_sala_at"), 8000);
    if (error) throw error;
    metaEnBase = true;
    chatMeta = new Map((data || []).map((r) => [r.user_id, { archivado: !!r.archivado, salas: (r.salas || []).map(Number), hist: (r.jugo_salas || []).map(Number), ultima: r.ultima_sala_at || null }]));
    escribirMetaLocal();
  } catch (_) { metaEnBase = false; }
  pintarContadoresSalas(); if (vistaChats !== "normal" || true) { try { renderListaClientes(); } catch (_) {} }
}
async function guardarMeta(uid, cambios) {
  const nuevo = { ...metaDe(uid), ...cambios };
  const agregadas = (nuevo.salas || []).filter((n) => !metaDe(uid).salas.includes(n));
  if (agregadas.length) { nuevo.hist = [...new Set([...(nuevo.hist || []), ...nuevo.salas])].sort(); nuevo.ultima = new Date().toISOString(); }   // el historial de jugadores nunca se borra
  chatMeta.set(uid, nuevo); escribirMetaLocal(); pintarContadoresSalas();
  try { renderListaClientes(); if (($("admin-vista-salas") && !$("admin-vista-salas").hidden) || ($("admin-vista-jugadores") && !$("admin-vista-jugadores").hidden)) pintarTodasSalas(); } catch (_) {}
  if (!metaEnBase) { avisarMetaLocal(); return; }
  try {
    const { error } = await supabase.from("admin_chat_meta").upsert({ user_id: uid, archivado: nuevo.archivado, salas: nuevo.salas, jugo_salas: nuevo.hist || [], ultima_sala_at: nuevo.ultima, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) throw error;
  } catch (_) { metaEnBase = false; avisarMetaLocal(); }
}
function avisarMetaLocal() {
  if (metaAvisada) return; metaAvisada = true;
  mostrarAviso("Quedó guardado solo en este navegador. Para verlo en todos tus dispositivos ejecutá novedades_clientes_v10.sql en Supabase.", "info");
}
let soloNoLeidos = false;
function pasaFiltroChats(uid) {
  const m = metaDe(uid);
  if (soloNoLeidos && !((resumenAdmin.get(uid) || {}).noLeidos > 0)) return false;
  if (vistaChats === "archivados") return m.archivado;
  if (vistaChats.startsWith("sala")) return !m.archivado && m.salas.includes(Number(vistaChats.slice(4)));
  return !m.archivado;   // Chats: lo archivado desaparece; las salas NO lo sacan de acá
}
function textoVacioChats() {
  if (soloNoLeidos) return "No tenés chats sin leer aquí ✔";
  if (vistaChats === "archivados") return "No hay chats archivados. Desde el menú ⋮ de un chat podés archivarlo.";
  if (vistaChats.startsWith("sala")) return "Todavía no hay nadie en la Sala " + vistaChats.slice(4) + ". Desde el menú ⋮ de un chat podés mandarlo acá.";
  return "Sin clientes todavía.";
}
function pintarAyudaChats() {
  const e = $("adm-ayuda-chats"); if (!e) return;
  let btn = $("adm-sacar-todos");
  if (!btn) { btn = document.createElement("button"); btn.type = "button"; btn.id = "adm-sacar-todos"; btn.className = "adm-sacar"; e.insertAdjacentElement("afterend", btn); btn.addEventListener("click", sacarATodosDeSala); }
  const nSala = vistaChats.startsWith("sala") ? Number(vistaChats.slice(4)) : 0;
  btn.hidden = !nSala;
  if (nSala) { const k = [...chatMeta.values()].filter((m) => (m.salas || []).includes(nSala) && !m.archivado).length; btn.textContent = `🧹 Sacar a todos de la Sala ${nSala} (${k})`; btn.disabled = !k; }
  e.textContent = vistaChats === "archivados" ? "Chats archivados. Tocá uno para verlo; desde ⋮ podés sacarlo de archivados."
    : vistaChats.startsWith("sala") ? `Clientes de la Sala ${vistaChats.slice(4)}. También siguen en Chats.`
    : "Tocá un cliente para ver su chat y acreditarle saldo.";
}
async function sacarATodosDeSala() {
  const n = vistaChats.startsWith("sala") ? Number(vistaChats.slice(4)) : 0; if (!n) return;
  const uids = [...chatMeta.entries()].filter(([, m]) => (m.salas || []).includes(n)).map(([id]) => id);
  if (!uids.length) return mostrarAviso(`La Sala ${n} ya está vacía.`, "info");
  const ok = await mostrarConfirmacion({ tono: "warn", icono: "🧹", titulo: `Vaciar la Sala ${n}`, texto: "Se los saca de esta sala. Siguen en Chats y en Jugadores (el historial no se borra).", filas: [["Clientes que salen", String(uids.length)]], confirmar: "Sacar a todos" });
  if (!ok) return;
  await Promise.all(uids.map((id) => guardarMeta(id, { salas: metaDe(id).salas.filter((x) => x !== n) })));
  try { if (clienteSel && chatFijado !== clienteSel.id && !pasaFiltroChats(clienteSel.id)) cerrarChatActual(); } catch (_) {}
  pintarAyudaChats(); renderListaClientes();
  mostrarAviso(`Sala ${n} vaciada: salieron ${uids.length}.`, "ok");
}
function pintarContadoresSalas() {
  const cuentas = { archivados: 0, sala1: 0, sala2: 0, sala3: 0, jugadores: 0 };
  chatMeta.forEach((m) => { if ((m.hist || []).length) cuentas.jugadores++; });
  chatMeta.forEach((m) => { if (m.archivado) cuentas.archivados++; else m.salas.forEach((n) => { if (cuentas["sala" + n] !== undefined) cuentas["sala" + n]++; }); });
  Object.entries(cuentas).forEach(([k, n]) => { const e = $("rt-n-" + k); if (e) { e.textContent = String(n); e.hidden = !n; } });
}
// cerrar chat
function cerrarChatActual() {
  if (esMovil()) { cerrarChatAdmin(false); return; }
  clearInterval(pollAdmin); clienteSel = null;
  const v = $("admin-chat-view");
  if (v) { v.replaceChildren(Object.assign(document.createElement("p"), { textContent: "Elegí un cliente de la lista para abrir su chat" })); v.firstChild.style.cssText = "font-size:13px;color:#888;text-align:center;margin:auto;"; v.style.justifyContent = "flex-start"; }
  renderListaClientes();
}

// ---- Todas las salas (los que están ahora) y Jugadores (historial permanente): lista sin repetir y aviso masivo
const filtroSalas = { sl: "todas", jg: "todas" };
function pintarTodasSalas() { pintarListaSalas("sl", "salas"); pintarListaSalas("jg", "jugadores"); }
const busquedaSalas = { sl: "", jg: "" };
function pintarListaSalas(pref, modo) {
  const chips = $(pref + "-chips"), lista = $(pref + "-lista"); if (!chips || !lista) return;
  const enSalas = (m) => (modo === "salas" ? m.salas : m.hist);
  const miembros = [];
  clientesAdmin.forEach((f) => { const m = metaDe(f[CONFIG.COL_ID]); if (enSalas(m).length) miembros.push({ f, m }); });
  const cuenta = (n) => miembros.filter((x) => enSalas(x.m).includes(n)).length;
  const defs = [["todas", "Todas", miembros.length], ["1", "Sala 1", cuenta(1)], ["2", "Sala 2", cuenta(2)], ["3", "Sala 3", cuenta(3)]];
  chips.replaceChildren(...defs.map(([k, t, n]) => { const b = document.createElement("button"); b.type = "button"; b.className = "sl-chip" + (filtroSalas[pref] === k ? " on" : ""); b.innerHTML = `${t} <b>${n}</b>`; b.addEventListener("click", () => { filtroSalas[pref] = k; pintarListaSalas(pref, modo); }); return b; }));
  if (!$(pref + "-buscar")) {   // lupa para encontrar a un jugador
    const w = document.createElement("div"); w.className = "sl-buscar";
    w.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i><input id="' + pref + '-buscar" type="search" placeholder="Buscar un jugador (nombre o mail)…" autocomplete="off" aria-label="Buscar un jugador">';
    chips.parentNode.insertBefore(w, chips);
    w.querySelector("input").addEventListener("input", (e) => { busquedaSalas[pref] = e.target.value.trim().toLowerCase(); pintarListaSalas(pref, modo); });
  }
  const q = busquedaSalas[pref] || "";
  const vis = miembros.filter((x) => (filtroSalas[pref] === "todas" || enSalas(x.m).includes(Number(filtroSalas[pref]))) && (!q || ((x.f[CONFIG.COL_NOMBRE] || "") + " " + (x.f[CONFIG.COL_EMAIL] || "")).toLowerCase().includes(q)));
  lista.replaceChildren();
  if (!vis.length) lista.appendChild(Object.assign(document.createElement("p"), { className: "adm-vacio", textContent: modo === "salas" ? "Todavía no anotaste a nadie. Desde el menú ⋮ de un chat tocá “Mandar a Sala 1/2/3”." : "Todavía no hay jugadores guardados. Cada persona que mandes a una sala queda acá para siempre." }));
  vis.forEach(({ f, m }) => {
    const r = document.createElement("div"); r.className = "sl-fila";
    const n = document.createElement("div"); n.className = "sl-n";
    const sub = (f[CONFIG.COL_EMAIL] || "") + (modo === "jugadores" && m.ultima ? " · última sala: " + new Date(m.ultima).toLocaleDateString("es-AR", { day: "numeric", month: "short" }) : "");
    n.append(Object.assign(document.createElement("b"), { textContent: f[CONFIG.COL_NOMBRE] || f[CONFIG.COL_EMAIL] || "Cliente" }), Object.assign(document.createElement("small"), { textContent: sub }));
    const t = document.createElement("div"); t.className = "sl-tags";
    enSalas(m).forEach((x) => t.appendChild(Object.assign(document.createElement("span"), { textContent: "Sala " + x })));
    r.append(n, t);
    if (modo === "salas") {
      const q = document.createElement("button"); q.type = "button"; q.className = "sl-quitar"; q.title = "Quitar de las salas (sigue en Jugadores)"; q.textContent = "✕";
      q.addEventListener("click", () => guardarMeta(f[CONFIG.COL_ID], { salas: filtroSalas[pref] === "todas" ? [] : m.salas.filter((x) => x !== Number(filtroSalas[pref])) }));
      r.appendChild(q);
    }
    if (modo === "jugadores") {
      const q2 = document.createElement("button"); q2.type = "button"; q2.className = "sl-quitar"; q2.title = "Sacar de la lista: no recibirá más avisos ni mails"; q2.textContent = "✕";
      q2.addEventListener("click", async () => {
        const nombre = f[CONFIG.COL_NOMBRE] || f[CONFIG.COL_EMAIL] || "este jugador";
        const ok = await mostrarConfirmacion({ tono: "warn", icono: "🚫", titulo: "Sacar de la lista", texto: `${nombre} dejará de recibir tus avisos (chat y mail) hasta que lo vuelvas a mandar a una sala. Sus compras y su chat no se tocan.`, confirmar: "Sí, sacarlo", cancelar: "No, volver" });
        if (!ok) return;
        const f2 = filtroSalas[pref], n2 = Number(f2);
        guardarMeta(f[CONFIG.COL_ID], f2 === "todas" ? { salas: [], hist: [] } : { salas: m.salas.filter((x) => x !== n2), hist: m.hist.filter((x) => x !== n2) });
        mostrarAviso(`${nombre} salió de la lista.`, "ok");
      });
      r.appendChild(q2);
    }
    lista.appendChild(r);
  });
  const btn = $(pref + "-enviar"); if (btn) { btn.disabled = !vis.length; btn.querySelector("span").textContent = vis.length ? `Avisar a ${vis.length} ${vis.length === 1 ? "persona" : "personas"}` : "Avisar"; btn._ids = vis.map((x) => x.f[CONFIG.COL_ID]); }
  const ta = $(pref + "-texto"); if (ta && !ta.dataset.tocado && document.activeElement !== ta) ta.value = "Hoy " + new Date().toLocaleDateString("es-AR", { weekday: "long" }) + " hay sala con Alma Zarela 🎮 ¡No pierdas tu lugar!";
}
async function enviarAvisoSalas(pref) {
  const btn = $(pref + "-enviar"), ta = $(pref + "-texto"); if (!btn || !ta) return;
  const ids = btn._ids || [], texto = ta.value.trim();
  if (!ids.length) return;
  if (!texto) return mostrarAviso("Escribí el mensaje que querés enviar.", "error");
  if (!usuarioActual) return mostrarAviso("Tu sesión expiró. Volvé a iniciar sesión.", "error");
  const ok = await mostrarConfirmacion({ tono: "warn", icono: "📣", titulo: `¿Avisar a ${ids.length} ${ids.length === 1 ? "persona" : "personas"}?`, texto: "Cada una recibe este mensaje en su chat de Zarela:", filas: [["Mensaje", texto]], confirmar: "Enviar aviso" });
  if (!ok) return;
  btn.disabled = true;
  try {
    const filas = ids.map((uid) => ({ [MSG.userCol]: uid, [MSG.senderCol]: usuarioActual.id, [MSG.textoCol]: texto, [MSG.leidoCol]: false }));
    const { error } = await supabase.from(MSG.tabla).insert(filas);
    if (error) throw error;
    mostrarAviso(`Aviso enviado a ${ids.length} ${ids.length === 1 ? "persona" : "personas"}. ✅`, "ok");
    try { enviarMailAviso(ids, texto); } catch (_) {}
  } catch (err) {
    console.error("Aviso masivo:", err);
    mostrarAviso("No se pudo enviar el aviso. Reintentá.", "error");
  } finally { btn.disabled = false; }
}
// mail por n8n/Gmail (queda activo cuando se ejecuta novedades_clientes_v11.sql y se conecta Gmail en n8n; si no, no pasa nada)
async function enviarMailAviso(ids, texto) {
  try { await supabase.rpc("admin_enviar_aviso_mail", { p_ids: ids, p_asunto: "Zarela · Sala de hoy 🎮", p_mensaje: texto }); } catch (_) {}
}
["sl", "jg"].forEach((pref) => {
  document.addEventListener("click", (e) => { if (e.target.closest("#" + pref + "-enviar")) enviarAvisoSalas(pref); });
  document.addEventListener("input", (e) => { if (e.target.id === pref + "-texto") e.target.dataset.tocado = "1"; });
});
supabase.auth.onAuthStateChange((_e, session) => { setTimeout(() => { if (session && (session.user.email || "").toLowerCase() === CONFIG.ADMIN_EMAIL.toLowerCase()) cargarChatMeta(); }, 700); });
Object.assign(window, { cerrarChatActual });


// =====================================================================
// v15: notificaciones push (llegan con la página cerrada y la pantalla apagada)
// =====================================================================
const VAPID_PUBLIC = "BAZouF4EmjLrwYXEKy83ffbn6vHL13yrA5o1t_pcgydUvog35xK6MeLLxaCW0EweDzBW-hQirIavZTP0HjfojSg";
const urlB64 = (b) => { const p = "=".repeat((4 - (b.length % 4)) % 4); const r = atob((b + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };
async function registrarPush(pedir) {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window) || !usuarioActual) return false;
    if (Notification.permission === "default" && pedir) await Notification.requestPermission();
    if (Notification.permission !== "granted") return false;
    const reg = await navigator.serviceWorker.register("sw.js");
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(VAPID_PUBLIC) });
    const j = sub.toJSON();
    const { error } = await supabase.rpc("guardar_push", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
    if (error) { console.warn("Push: falta ejecutar novedades_clientes_v14.sql", error.message); return false; }
    pushActivo = true;
    return true;
  } catch (err) { console.warn("Push no disponible:", err); return false; }
}
async function desuscribirPush() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration("sw.js"); const sub = await reg?.pushManager.getSubscription(); if (!sub) return;
    const ep = sub.endpoint; await sub.unsubscribe(); await supabase.rpc("borrar_push", { p_endpoint: ep });
  } catch (_) {}
}
supabase.auth.onAuthStateChange((_e, session) => { if (session) setTimeout(async () => { if (avisosOn() && "Notification" in window && Notification.permission === "granted") await registrarPush(false); pintarBotonAvisos(); }, 1500); else { pushActivo = false; pintarBotonAvisos(); } });


// =====================================================================
// v16: "entregado" apenas la administradora tiene la página abierta + fondo de pantalla del chat
// =====================================================================
setInterval(() => {
  if (!entregaDisponible || !esAdminActual() || document.hidden) return;
  try { supabase.rpc("admin_marcar_entregados").then(() => {}, () => {}); } catch (_) {}
}, 15000);
supabase.auth.onAuthStateChange((_e, session) => { if (session && (session.user.email || "").toLowerCase() === CONFIG.ADMIN_EMAIL.toLowerCase()) setTimeout(() => { try { supabase.rpc("admin_marcar_entregados").then(() => {}, () => {}); } catch (_) {} }, 1200); });

const FONDOS_CHAT = [
  { id: "ninguno", n: "Cristal transparente", css: "linear-gradient(160deg,rgba(255,255,255,.55),rgba(255,255,255,.15))" },
  { id: "cristal", n: "Cristal azul", css: "radial-gradient(circle at 20% 0%,rgba(80,150,230,.2),transparent 55%),linear-gradient(160deg,#0a1a38,#04070f)" },
  { id: "orion", n: "Verde Orión", css: "radial-gradient(ellipse at 50% -10%,rgba(25,230,140,.26),transparent 62%),linear-gradient(180deg,#07291d,#020a07)" },
  { id: "rosa", n: "Rosa oscuro", css: "radial-gradient(circle at 80% 0%,rgba(255,92,138,.22),transparent 55%),linear-gradient(160deg,#25091a,#0a040a)" },
  { id: "noche", n: "Noche", css: "linear-gradient(160deg,#0f1224,#030409)" },
  { id: "ff", n: "Free Fire", css: "linear-gradient(rgba(3,5,14,.78),rgba(3,5,14,.78)),url('fondo-difuminado.jpg') center/cover" },
];
const claveFondo = "zarela_chat_fondo";
function fondoGuardado() { try { return JSON.parse(localStorage.getItem(claveFondo) || "null"); } catch (_) { return null; } }
function aplicarFondoChat() {
  const f = fondoGuardado(); let css = "";
  if (f?.tipo === "preset" && f.id !== "ninguno") css = (FONDOS_CHAT.find((x) => x.id === f.id) || {}).css || "";
  else if (f?.tipo === "foto" && f.data) css = `linear-gradient(rgba(3,5,14,.6),rgba(3,5,14,.6)),url(${f.data}) center/cover`;
  document.documentElement.style.setProperty("--chat-fondo", css || "none");
  document.body.classList.toggle("chat-con-fondo", !!css);
}
function elegirFondo(v) { try { localStorage.setItem(claveFondo, JSON.stringify(v)); } catch (_) { mostrarAviso("No se pudo guardar el fondo en este dispositivo.", "error"); } aplicarFondoChat(); pintarSelectorFondo(); }
function pintarSelectorFondo() {
  const cont = $("fch-grid"); if (!cont) return; const f = fondoGuardado();
  cont.replaceChildren(...FONDOS_CHAT.map((x) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "fch-op" + ((f?.tipo === "preset" && f.id === x.id) || (!f && x.id === "ninguno") ? " on" : "");
    b.innerHTML = `<i style="background:${x.css}"></i><span>${x.n}</span>`;
    b.addEventListener("click", () => elegirFondo({ tipo: "preset", id: x.id })); return b;
  }));
}
function abrirSelectorFondo() {
  let m = $("fch-modal");
  if (!m) {
    m = document.createElement("div"); m.id = "fch-modal"; m.className = "fch-modal";
    m.innerHTML = `<div class="fch-box" role="dialog" aria-label="Fondo del chat"><div class="fch-top"><b>🖼️ Fondo del chat</b><button type="button" class="fch-x" aria-label="Cerrar">✕</button></div><div id="fch-grid" class="fch-grid"></div><label class="fch-foto"><input type="file" accept="image/*" hidden> <span>📷 Usar mi propia foto</span></label><small>El fondo se guarda solo en este dispositivo.</small></div>`;
    document.body.appendChild(m);
    m.addEventListener("click", (e) => { if (e.target === m || e.target.closest(".fch-x")) m.classList.remove("abierto"); });
    m.querySelector("input").addEventListener("change", (e) => {
      const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
      const img = new Image(); const u = URL.createObjectURL(file);
      img.onload = () => { const k = Math.min(1, 900 / Math.max(img.width, img.height)); const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u); elegirFondo({ tipo: "foto", data: c.toDataURL("image/jpeg", 0.72) }); };
      img.onerror = () => mostrarAviso("No se pudo leer esa imagen.", "error"); img.src = u;
    });
  }
  pintarSelectorFondo(); m.classList.add("abierto");
}
Object.assign(window, { abrirSelectorFondo });
aplicarFondoChat();
// entrada en el menú ⋮ del chat de la administradora
{
  const prev = armarMenuChat;
  armarMenuChat = function () {
    const ya = $("admin-chat-view")?.querySelector(".adm-cab")?.dataset.menu;
    prev();
    if (ya) return;
    const menu = $("admin-chat-view")?.querySelector(".adm-menu"); if (!menu || menu.querySelector(".adm-fondo")) return;
    const b = document.createElement("button"); b.type = "button"; b.className = "adm-mi adm-fondo"; b.innerHTML = "<span>🖼️</span><b>Fondo del chat</b>";
    b.addEventListener("click", () => { menu.hidden = true; abrirSelectorFondo(); });
    menu.appendChild(b);
  };
}


// =====================================================================
// v17: instalar la app (PWA) desde la página
// =====================================================================
let promptInstalar = null;
const esStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); promptInstalar = e; pintarInstalar(); });
window.addEventListener("appinstalled", () => { promptInstalar = null; pintarInstalar(); });
function pintarInstalar() { const b = $("sb-instalar"); if (b) b.hidden = esStandalone(); }
function modalInstalar() {
  const ua = navigator.userAgent, ios = /iPhone|iPad|iPod/.test(ua), and = /Android/.test(ua);
  const pasos = ios ? ["Abrí esta página en <b>Safari</b>.", "Tocá el botón <b>Compartir</b> (el cuadrado con la flecha hacia arriba).", "Elegí <b>Agregar a pantalla de inicio</b> y tocá <b>Agregar</b>."]
    : and ? ["Abrí esta página en <b>Chrome</b>.", "Tocá los <b>3 puntitos</b> (⋮) de arriba a la derecha.", "Elegí <b>Instalar aplicación</b> o <b>Agregar a la pantalla de inicio</b>.", "Confirmá con <b>Instalar</b>."]
    : ["En <b>Chrome</b> o <b>Edge</b>, mirá a la derecha de la barra de direcciones.", "Tocá el ícono de <b>instalar</b> (una pantallita con una flecha).", "Confirmá con <b>Instalar</b>."];
  let m = $("inst-modal"); if (!m) { m = document.createElement("div"); m.id = "inst-modal"; m.className = "fch-modal"; document.body.appendChild(m); m.addEventListener("click", (e) => { if (e.target === m || e.target.closest(".fch-x")) m.classList.remove("abierto"); }); }
  m.innerHTML = `<div class="fch-box" role="dialog" aria-label="Descargar app"><div class="fch-top"><b>📲 Descargar la app de Zarela</b><button type="button" class="fch-x" aria-label="Cerrar">✕</button></div><ol class="inst-pasos">${pasos.map((x) => `<li>${x}</li>`).join("")}</ol><small>Funciona igual que la página y se actualiza sola. Si ya la instalaste, buscá el ícono “Zarela” en tu pantalla.</small></div>`;
  m.classList.add("abierto");
}
async function instalarApp() {
  if (promptInstalar) { try { promptInstalar.prompt(); await promptInstalar.userChoice; } catch (_) {} promptInstalar = null; pintarInstalar(); return; }
  modalInstalar();
}
document.addEventListener("DOMContentLoaded", () => { pintarInstalar(); $("sb-instalar")?.addEventListener("click", () => { try { toggleMenu(); } catch (_) {} instalarApp(); }); });


// =====================================================================
// v24: botón rojo ❓ de "algo está fallando" (solo administrador) con guía de cómo arreglarlo
// =====================================================================
// Cosas que están a medio hacer (se muestran al final del «Estado del sistema» para que nada se olvide). Editá esta lista cuando algo se termine.
const PENDIENTES_DESARROLLO = [
  { id: "tarjeta", titulo: "Cargar saldo con tarjeta: el botón existe pero todavía no funciona", detalle: "Dice «Próximamente». Falta elegir el medio de cobro y conectarlo para que acredite solo.", pasos: ["Decidir qué proveedor de cobro con tarjeta vas a usar.", "Pasárselo a Claude para conectarlo (los datos de la tarjeta los maneja el proveedor, nunca la página)."] },
  { id: "whatsapp", titulo: "Atención por WhatsApp: falta definir el enlace", detalle: "En el menú el botón dice «Próximamente» y no hace nada.", pasos: ["Cuando tengas el número o el enlace de WhatsApp Business, pasáselo a Claude."] },
  { id: "descuento", titulo: "Compras con descuento (Pago Store): se revisa a mano", detalle: "No hay forma automática y segura de saber qué IDs tienen el 50 %. La página recuerda qué ID + paquete ya resolviste para no mandártelo de nuevo.", pasos: ["Usá «Ya la cargué» o «Mandar con PIN» en cada pedido: así queda registrado."] },
  { id: "referidos", titulo: "Programa de referidos: pospuesto", detalle: "Quedó para más adelante por el tema de cuentas múltiples y montos.", pasos: ["Cuando quieras retomarlo, decímelo y lo planificamos."] },
];
// Convierte el texto técnico de un error en algo entendible
function traducirError(m) {
  const t = String(m || "");
  let r;
  if ((r = /(?:Uncaught )?ReferenceError:\s*([\w$]+) is not defined/i.exec(t))) return { titulo: `Un botón llama a algo que no existe («${r[1]}»)`, detalle: "Es un fallo de programación: algún botón o función de la página no quedó conectado.", pasos: ["Tocá «Copiar informe» y mandámelo, así lo arreglo.", "Mientras tanto, ese botón puntual no va a funcionar; el resto de la página sí."] };
  if ((r = /Cannot read propert(?:y|ies) of (?:null|undefined)(?: \(reading '([^']+)'\))?/i.exec(t))) return { titulo: "La página intentó usar algo que no estaba en pantalla" + (r[1] ? ` («${r[1]}»)` : ""), detalle: "Pasa cuando una parte se dibuja tarde o falta. Casi siempre es pasajero.", pasos: ["Recargá con Ctrl+F5.", "Si se repite, mandame el informe."] };
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(t)) return { titulo: "Se cortó la conexión con el servidor un momento", detalle: "Internet inestable o el servidor tardó en contestar.", pasos: ["Si todo anda, ignorarlo.", "Si se repite mucho, revisá tu internet y que n8n / Docker estén abiertos."] };
  if (/ResizeObserver/i.test(t)) return { titulo: "Aviso menor del navegador al cambiar el tamaño de la ventana", detalle: "No afecta nada.", pasos: ["Se puede ignorar."] };
  if (/timeout|AbortError|tiempo agotado/i.test(t)) return { titulo: "Algo tardó demasiado en responder", detalle: "Un servicio (n8n, Supabase o el buscador de ID) no contestó a tiempo.", pasos: ["Fijate que n8n y Docker estén abiertos.", "Si se repite, mandame el informe."] };
  if (/JWT|auth|sesi[oó]n/i.test(t)) return { titulo: "Problema con la sesión iniciada", detalle: "La sesión venció o se cortó.", pasos: ["Cerrá sesión y volvé a entrar con Google."] };
  return { titulo: "Fallo técnico de la página", detalle: "No lo reconozco como algo conocido.", pasos: ["Recargá con Ctrl+F5.", "Si vuelve, mandame el informe con lo que estabas haciendo."] };
}
const erroresPagina = [];
window.addEventListener("error", (e) => { erroresPagina.push({ t: Date.now(), m: String(e.message || "error").slice(0, 200), d: (e.filename || "").split("/").pop() + ":" + (e.lineno || "") }); if (erroresPagina.length > 20) erroresPagina.shift(); });
window.addEventListener("unhandledrejection", (e) => { erroresPagina.push({ t: Date.now(), m: String((e.reason && e.reason.message) || e.reason || "promesa rechazada").slice(0, 200), d: "promesa" }); if (erroresPagina.length > 20) erroresPagina.shift(); });
let saludProblemas = [], saludRevisando = false, saludUltima = 0;
const irPanelAdmin = (vista) => () => { cerrarSalud(); try { mostrarVistaAdmin(vista); } catch (_) {} setTimeout(() => ($("admin-panel-section") || $("admin-vista-" + vista))?.scrollIntoView({ behavior: "smooth", block: "start" }), 120); };
const textoMin = (min) => (min < 120 ? min + " min" : Math.floor(min / 60) + " h");

async function saludReunir() {
  const out = [];
  // --- Órdenes
  let ords = [];
  try {
    const cols = ["id", "estado", "envio_error", "n8n_http_status", "created_at", "updated_at", "id_jugador", "diamantes"];
    let r = await conTimeout(supabase.from("ordenes_recarga").select(cols.join(",")).order("created_at", { ascending: false }).limit(60), 12000);
    if (r.error) r = await conTimeout(supabase.from("ordenes_recarga").select("id,estado,created_at,updated_at,id_jugador,diamantes").order("created_at", { ascending: false }).limit(60), 12000);
    if (r.error) throw r.error;
    ords = r.data || [];
  } catch (e) {
    out.push({ id: "ord-lectura", nivel: "alto", icono: "📦", titulo: "No se pudo leer la lista de órdenes",
      detalle: "La página no logró consultar las órdenes en Supabase: " + String((e && e.message) || e).slice(0, 160),
      pasos: ["Recargá la página con Ctrl+F5 y volvé a entrar al modo administrador.", "Si sigue igual, entrá a supabase.com → tu proyecto → Table Editor → ordenes_recarga y fijate si abre. Si Supabase está caído, esperá unos minutos: no se pierde nada.", "Si abre pero la página no: Authentication → Policies → ordenes_recarga debe tener una política que te deje leer todo con tu mail de administrador (está en pines_y_compras.sql).", "Si nada de eso alcanza, copiá el informe (botón de abajo) y mandámelo."],
      ir: irPanelAdmin("ordenes"), irTxt: "Ir a Órdenes" });
  }
  const ahora = Date.now();
  const edad = (o) => Math.floor((ahora - new Date(o.updated_at || o.created_at).getTime()) / 60000);
  const revisar = ords.filter((o) => o.estado === "pendiente" && /REVISAR A MANO/i.test(o.envio_error || ""));
  if (revisar.length) out.push({ id: "ord-incierto", nivel: "alto", icono: "🔎", titulo: `${revisar.length} orden${revisar.length > 1 ? "es" : ""} para revisar a mano: ${revisar.map((o) => "#" + o.id).join(", ")}`,
    detalle: "El robot de canje intentó cargar los diamantes pero NO pudo confirmar si salieron. Por seguridad no reintenta ni devuelve nada solo (podrían haberse entregado igual). Mensaje del robot: " + String(revisar[0].envio_error || "").replace(/^⚠\s*REVISAR A MANO\s*·?\s*/i, "").slice(0, 280),
    pasos: ["NO toques «Reenviar» todavía: si el PIN ya se usó, reenviar lo gastaría de nuevo.", "Entrá a redeempins.com (tu cuenta de canje) y buscá el PIN de esa orden. ¿Figura como usado / canjeado?", "PIN usado → los diamantes salieron. Pedile al cliente que reinicie Free Fire y mirá que los tenga. En Órdenes tocá «✅ Ya se acreditó».", "PIN sin usar → no salió nada. En Órdenes tocá «🔁 Reenviar a n8n» (vuelve a intentar con el mismo PIN, sin cobrar de nuevo).", "Si el ID del cliente está mal o no hay forma de recargar → «✖ Cancelar y devolver»: le devuelve el saldo y el PIN vuelve a tu stock.", "Si pasa seguido: mirá en n8n → Ejecuciones la corrida de esa orden y abrí el nodo «Canjear en redeempins»: ahí está la respuesta exacta del robot (campo «mensaje» y «codigo»)."],
    ir: irPanelAdmin("ordenes"), irTxt: "Ir a Órdenes" });
  const errEnv = ords.filter((o) => o.estado === "error_envio");
  if (errEnv.length) out.push({ id: "ord-envio", nivel: "alto", icono: "📡", titulo: `${errEnv.length} orden${errEnv.length > 1 ? "es" : ""} no llegó a n8n: ${errEnv.map((o) => "#" + o.id).join(", ")}`,
    detalle: "La compra está cobrada y el PIN reservado, pero n8n no recibió el aviso. " + String(errEnv[0].envio_error || "").slice(0, 200),
    pasos: ["Abrí n8n y fijate que el flujo «canje finalizado» esté Activo (interruptor arriba a la derecha, en verde).", "Fijate que Docker Desktop esté abierto y el contenedor de n8n corriendo (en Docker Desktop → Containers).", "Probá abrir https://n8n.almazarela.com en el navegador. Si no abre, el túnel/dominio está caído: reiniciá el túnel (Cloudflare) en tu PC.", "Con todo funcionando, andá a Órdenes y tocá «🔁 Reenviar a n8n» en cada una.", "Mientras tanto el cliente ve «En espera: se acredita apenas retomemos las recargas»: no pierde nada."],
    ir: irPanelAdmin("ordenes"), irTxt: "Ir a Órdenes" });
  const colgadas = ords.filter((o) => o.estado === "pendiente" && !/REVISAR A MANO/i.test(o.envio_error || "") && edad(o) >= 6);
  if (colgadas.length) out.push({ id: "ord-colgada", nivel: "medio", icono: "⏳", titulo: `${colgadas.length} orden${colgadas.length > 1 ? "es" : ""} pendiente${colgadas.length > 1 ? "s" : ""} hace rato: ${colgadas.slice(0, 5).map((o) => "#" + o.id + " (" + textoMin(edad(o)) + ")").join(", ")}`,
    detalle: "n8n recibió la orden pero todavía no avisó el resultado. Normalmente tarda menos de un minuto; si pasaron más de 5, algo se trabó (el robot, redeempins.com o tu PC).",
    pasos: ["Abrí n8n → Ejecuciones y buscá la de esa orden: si está en rojo o todavía «Running», ahí está el problema.", "Revisá que Docker Desktop esté abierto y el servicio de canje (el robot, puerto 8080) corriendo. Si lo reiniciás, la orden queda marcada «para revisar a mano».", "Abrí redeempins.com a mano: si da error (por ejemplo «520»), el sitio está caído y hay que esperar.", "Antes de reenviar, verificá en redeempins.com si el PIN ya se usó (si se usó, tocá «✅ Ya se acreditó»; si no, «🔁 Reenviar a n8n»)."],
    ir: irPanelAdmin("ordenes"), irTxt: "Ir a Órdenes" });
  // --- Stock de PINs
  await stockLimCargar();
  try {
    const { data, error } = await conTimeout(supabase.rpc("admin_stock_pines"), 12000);
    if (error) throw error;
    // Solo los paquetes que de verdad se venden con stock (los mismos que muestra la pestaña Stock); el resto no cuenta
    const reales = (data || []).filter((x) => ETIQUETA_STOCK[x.paquete_id]);
    const lista = reales.length ? reales : (data || []);
    const nom = (x) => (ETIQUETA_STOCK[x.paquete_id] ? ETIQUETA_STOCK[x.paquete_id] + " 💎" : x.nombre || x.diamantes + " 💎");
    const sin = lista.filter((x) => Number(x.disponibles) === 0), pocos = lista.filter((x) => Number(x.disponibles) > 0 && Number(x.disponibles) <= limPk(x.paquete_id).pocos);
    if (sin.length) out.push({ id: "stock-cero", nivel: "alto", icono: "📉", titulo: `Sin PINs para: ${sin.map(nom).join(", ")}`,
      detalle: "Si un cliente compra ese paquete, no hay PIN para entregarle.",
      pasos: ["Comprá PINs en tu proveedor para esos paquetes.", "En el panel andá a Stock, elegí el paquete y pegá los códigos (uno por línea) con «Agregar PINs».", "Cuando haya stock vuelve a quedar todo en verde."],
      ir: irPanelAdmin("stock"), irTxt: "Ir a Stock" });
    if (pocos.length) out.push({ id: "stock-poco", nivel: "alto", icono: "📉", titulo: `Quedan muy pocos PINs: ${pocos.map((x) => nom(x) + " (" + x.disponibles + ")").join(", ")}`,
      detalle: "Todavía alcanza, pero conviene reponer pronto.", pasos: ["Comprá PINs de esos paquetes.", "En Stock pegá los códigos con «Agregar PINs»."], ir: irPanelAdmin("stock"), irTxt: "Ir a Stock" });
  } catch (e) {
    const falta = /PGRST202|42883|admin_stock_pines/i.test(String((e && (e.code || e.message)) || ""));
    out.push({ id: "stock-error", nivel: "medio", icono: "📉", titulo: falta ? "Falta activar el control de stock" : "No se pudo leer el stock de PINs",
      detalle: falta ? "La función admin_stock_pines no existe en Supabase." : String((e && e.message) || e).slice(0, 160),
      pasos: falta ? ["Abrí Supabase → SQL Editor.", "Pegá el contenido del archivo stock_pines_admin.sql y tocá Run."] : ["Recargá con Ctrl+F5.", "Si sigue, mirá en Supabase que la tabla pines_stock exista."], ir: irPanelAdmin("stock"), irTxt: "Ir a Stock" });
  }
  // --- Piezas de base de datos que faltan
  if (ordenesColsEnvio === false || revisarEnviosDisponible === false) out.push({ id: "sql-envio", nivel: "medio", icono: "🧩", titulo: "Falta ejecutar n8n_envio_fix.sql",
    detalle: "Sin esa pieza, el panel no puede confirmar qué respondió n8n a cada envío.", pasos: ["Supabase → SQL Editor.", "Pegá el contenido de n8n_envio_fix.sql y tocá Run (se puede repetir sin problema)."], ir: irPanelAdmin("ordenes"), irTxt: "Ir a Órdenes" });
  // --- Estado del servicio
  if ($("zt-estado")?.classList.contains("lento")) out.push({ id: "servicio-lento", nivel: "bajo", icono: "🐢", titulo: "La página muestra «Recargas demoradas»",
    detalle: "Los clientes ven ese cartel cuando hay pedidos sin resolver hace rato, o cuando n8n tarda más de 5 segundos en contestar el «ping» (por ejemplo, si el flujo del verificador de ID está lento o apagado).", pasos: ["Resolvé las órdenes pendientes de arriba: el aviso se apaga solo cuando no quedan.", "Importá en n8n el flujo id_del_jugador_FIX9.json (responde el ping al instante) y dejalo Activo en lugar del anterior.", "Si no hay ninguna pendiente, esperá 1–2 minutos y se actualiza."], ir: irPanelAdmin("ordenes"), irTxt: "Ir a Órdenes" });
  // --- Errores de la propia página
  // --- Errores de la propia página, explicados en castellano (el texto técnico queda abajo para pasárselo a Claude)
  const recientes = erroresPagina.filter((x) => ahora - x.t < 30 * 60000);
  if (recientes.length) {
    const grupos = new Map();
    recientes.forEach((x) => { const k = x.m; const g = grupos.get(k) || { m: x.m, d: x.d, n: 0, ult: 0 }; g.n++; g.ult = Math.max(g.ult, x.t); grupos.set(k, g); });
    out.push({ id: "pag-errores", nivel: "bajo", icono: "🐞", titulo: `La página registró ${recientes.length} error${recientes.length > 1 ? "es" : ""} técnico${recientes.length > 1 ? "s" : ""} (${grupos.size} distinto${grupos.size > 1 ? "s" : ""})`,
      detalle: "Son fallos de la propia página (no tienen que ver con el stock ni con las recargas). Cada uno está explicado abajo.",
      pasos: ["Recargá con Ctrl+F5 y fijate si vuelven a aparecer.", "Si vuelven, tocá «Copiar informe» y mandámelo para que los arregle."], ir: null });
    [...grupos.values()].sort((x, y) => y.ult - x.ult).slice(0, 5).forEach((g, i) => {
      const t = traducirError(g.m);
      out.push({ id: "pag-err-" + i, nivel: "bajo", icono: "🔧", titulo: t.titulo + (g.n > 1 ? ` (se repitió ${g.n} veces)` : ""),
        detalle: t.detalle + " · Último hace " + textoMin(Math.max(0, Math.round((ahora - g.ult) / 60000))) + ". Texto técnico para Claude: " + g.m + " (" + g.d + ")",
        pasos: t.pasos, ir: null });
    });
  }
  // --- Piezas de Supabase nuevas que todavía no ejecutaste
  const faltaRpc = async (nombre, args) => { try { const r = await conTimeout(supabase.rpc(nombre, args), 8000); const c = String((r.error && (r.error.code || r.error.message)) || ""); return /PGRST202|42883|does not exist|Could not find/i.test(c); } catch (_) { return false; } };
  const [f22, f23] = await Promise.all([faltaRpc("soporte_estado"), faltaRpc("admin_promo_resultado", { p_id: "0", p_diamantes: 0, p_resultado: "probar" })]);
  if (f22) out.push({ id: "sql-v22", nivel: "medio", icono: "🧩", titulo: "Falta ejecutar novedades_clientes_v22.sql",
    detalle: "Sin esa pieza no funcionan los segundos a elección del modo «Estoy disponible» ni el estado En línea / Desconectada.",
    pasos: ["Abrí Supabase → SQL Editor.", "Pegá el contenido del archivo novedades_clientes_v22.sql (está en Downloads\\canje-fix) y tocá Run."], ir: null });
  if (f23) out.push({ id: "sql-v23", nivel: "medio", icono: "🧩", titulo: "Falta ejecutar novedades_clientes_v25.sql",
    detalle: "Sin esa pieza la página no se acuerda qué IDs y paquetes ya resolviste en Pago Store.",
    pasos: ["Abrí Supabase → SQL Editor.", "Pegá el contenido del archivo novedades_clientes_v25.sql (está en Downloads\\canje-fix) y tocá Run."], ir: null });
  // --- El buscador de nombre / banner / icono del ID
  if (verifSinNombre) out.push({ id: "verif-nombre", nivel: "medio", icono: "🪪", titulo: "No se está pudiendo traer el nombre, banner e icono del ID",
    detalle: "El ID se carga igual y se puede comprar, pero la tarjeta muestra solo el número. Los servicios gratuitos que consultamos están caídos o sin cuentas, y Garena protege su propia consulta con una verificación para humanos.",
    pasos: ["No hace falta hacer nada para poder vender: el cliente confirma su ID a mano.", "Para tenerlo estable hace falta una clave de un servicio de consulta (por ejemplo, una clave gratis de siambhau, que se pide por Telegram). Pasásela a Claude y la prueba."], ir: null });
  // --- Lo que está a medio hacer (para que no se te olvide)
  PENDIENTES_DESARROLLO.forEach((p) => out.push({ id: "todo-" + p.id, nivel: "info", icono: "📝", titulo: p.titulo, detalle: p.detalle, pasos: p.pasos, ir: null }));
  const orden = { alto: 0, medio: 1, bajo: 2, info: 3 };
  return out.sort((a, b) => orden[a.nivel] - orden[b.nivel]);
}
async function saludRevisar() {
  if (saludRevisando || !esAdminActual()) return;
  saludRevisando = true;
  try { saludProblemas = await saludReunir(); saludUltima = Date.now(); } catch (e) { console.warn("Revisión de salud:", e); }
  finally { saludRevisando = false; }
  pintarBotonSalud();
  if (!$("salud-modal")?.hidden) pintarSalud();
}
function pintarBotonSalud() {
  const b = $("btn-salud"); if (!b) return;
  const n = saludProblemas.filter((p) => p.nivel === "alto").length, total = saludProblemas.length;   // rojo: PINs que faltan / se acaban y fallas de órdenes
  b.classList.toggle("mal", n > 0); b.classList.toggle("aviso", n === 0 && total > 0); b.classList.toggle("bien", total === 0);
  b.querySelector("em").textContent = n ? String(n) : total ? String(total) : "✓";
  b.title = n ? `${n} cosa${n > 1 ? "s" : ""} urgente${n > 1 ? "s" : ""}` : total ? `${total} pendiente${total > 1 ? "s" : ""} para más adelante` : "Todo en orden";
}
function pintarSalud() {
  const lista = $("salud-lista"); if (!lista) return;
  lista.replaceChildren();
  if (!saludProblemas.length) {
    const ok = document.createElement("div"); ok.className = "sl-ok"; ok.textContent = "✅ Todo en orden: no hay órdenes trabadas, hay PINs en stock y la página no registró errores.";
    lista.appendChild(ok);
  }
  saludProblemas.forEach((p) => {
    const card = document.createElement("div"); card.className = "sl-prob " + p.nivel;
    const cab = document.createElement("div"); cab.className = "sl-cab";
    const t = document.createElement("div"); t.className = "sl-tit"; t.textContent = p.icono + " " + p.titulo;
    const q = document.createElement("button"); q.type = "button"; q.className = "sl-q"; q.textContent = "?"; q.title = "¿Cómo se arregla?"; q.setAttribute("aria-label", "Cómo se arregla"); q.setAttribute("aria-expanded", "false");
    cab.append(t, q);
    const d = document.createElement("p"); d.className = "sl-det"; d.textContent = p.detalle;
    const pasos = document.createElement("div"); pasos.className = "sl-pasos"; pasos.hidden = true;
    const h = document.createElement("b"); h.textContent = "Cómo arreglarlo, paso a paso:";
    const ol = document.createElement("ol"); p.pasos.forEach((x) => { const li = document.createElement("li"); li.textContent = x; ol.appendChild(li); });
    pasos.append(h, ol);
    q.addEventListener("click", () => { pasos.hidden = !pasos.hidden; q.setAttribute("aria-expanded", String(!pasos.hidden)); q.classList.toggle("on", !pasos.hidden); });
    card.append(cab, d, pasos);
    if (p.ir) { const go = document.createElement("button"); go.type = "button"; go.className = "sl-ir"; go.textContent = "➜ " + p.irTxt; go.addEventListener("click", p.ir); card.appendChild(go); }
    lista.appendChild(card);
  });
  const pie = $("salud-pie"); if (pie) pie.textContent = saludUltima ? "Última revisión: " + new Date(saludUltima).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : "";
}
function abrirSalud() { const m = $("salud-modal"); if (!m) return; m.hidden = false; pintarSalud(); saludRevisar(); }
function cerrarSalud() { const m = $("salud-modal"); if (m) m.hidden = true; }
function copiarInformeSalud() {
  const txt = ["INFORME DE SALUD · almazarela.com · " + new Date().toLocaleString("es-AR"), ""].concat(saludProblemas.length ? saludProblemas.map((p, i) => `${i + 1}. [${p.nivel}] ${p.titulo}\n   ${p.detalle}`) : ["Sin problemas detectados."]).join("\n");
  const ok = () => mostrarAviso("Informe copiado: pegalo en el chat conmigo.", "ok");
  try { navigator.clipboard.writeText(txt).then(ok, () => mostrarAviso("No se pudo copiar.", "error")); } catch (_) { mostrarAviso("No se pudo copiar.", "error"); }
}
Object.assign(window, { abrirSalud, cerrarSalud, copiarInformeSalud, saludRevisar });
setInterval(() => { if (!document.hidden && esAdminActual() && document.body.classList.contains("modo-admin")) saludRevisar(); }, 60000);
new MutationObserver(() => { if (document.body.classList.contains("modo-admin") && Date.now() - saludUltima > 15000) saludRevisar(); }).observe(document.body, { attributes: true, attributeFilter: ["class"] });

// Tocar "Zarela" (arriba a la izquierda) en modo administrador: vuelve a la página normal
document.addEventListener("DOMContentLoaded", () => {
  const logo = document.querySelector(".nav-left .logo"); if (!logo) return;
  logo.addEventListener("click", () => {
    if (!document.body.classList.contains("modo-admin")) return;
    try { cerrarSalud(); } catch (_) {}
    try { salirModoAdmin(); } catch (e) { console.warn("No se pudo salir del modo administrador:", e); document.body.classList.remove("modo-admin"); }
  });
});

// ---- Historial de notificaciones (todos los dispositivos): avisos vistos en este equipo + estado real de tus órdenes y saldo
const nhK = (n) => "zarela_nh_" + n + "_" + (usuarioActual ? usuarioActual.id : "x");
const nhLeer = (n, def) => { try { const v = JSON.parse(localStorage.getItem(nhK(n))); return v == null ? def : v; } catch (_) { return def; } };
const nhGuardar = (n, v) => { try { localStorage.setItem(nhK(n), JSON.stringify(v)); } catch (_) {} };
let nhMovs = [];   // movimientos de saldo traídos del servidor
function anotarNotif(ic, txt, clave) {
  if (!usuarioActual || !txt) return;
  const lista = nhLeer("log", []);
  const k = clave || ("t_" + txt);
  if (lista.some((e) => e.k === k && (clave || Date.now() - e.t < 120000))) return;
  lista.unshift({ t: Date.now(), ic, txt, k });
  nhGuardar("log", lista.slice(0, 40));
  nhBadge();
}
function nhEventos() {
  const corte = nhLeer("corte", 0), ev = [], vistos = new Set();
  const movT = nhMovs.filter((m) => Number(m.monto) > 0).map((m) => new Date(m.created_at).getTime());
  nhLeer("log", []).forEach((e) => {
    if (/^saldo_/.test(e.k || "") && movT.some((t) => Math.abs(t - e.t) < 15 * 60000)) return;   // el movimiento real ya lo cuenta: una sola vez
    vistos.add(e.k); ev.push(e);
  });
  const add = (k, t, ic, txt) => { if (vistos.has(k) || !t || Number.isNaN(t)) return; vistos.add(k); ev.push({ k, t, ic, txt }); };
  (comprasUsuario || []).slice(0, 10).forEach((o) => {
    const t = new Date(o.created_at).getTime(), n = "#" + numCompra(o), idj = o.id_jugador ? " al ID " + o.id_jugador : "", dia = o.diamantes ? fmtNum(o.diamantes) + " 💎" : "diamantes";
    const nm = o.id_jugador ? nombreGuardado(String(o.id_jugador)) : "", sub = nm ? "\n👤 " + nm : "";
    add("o" + o.id + "_env", t, "📨", `Tu orden ${n} fue enviada${idj}.${sub}`);
    if (o.estado === "pendiente" || o.estado === "error_envio") add("o" + o.id + "_pend", t + 1, "⏳", `Tu orden ${n} está en proceso (${dia}).`);
    else if (o.estado === "completada") add("o" + o.id + "_completada", t + 2, "✅", `Se acreditaron ${dia}${idj} (orden ${n}).${sub}`);
    else if (o.estado === "fallida") add("o" + o.id + "_fallida", t + 2, "↩️", `La orden ${n} no se pudo acreditar: tu saldo fue devuelto.`);
  });
  nhMovs.forEach((m) => {
    const monto = Number(m.monto) || 0; if (monto <= 0) return;
    const mon = m.moneda === "ARS" ? "ARS" : "USD";
    add("m_" + m.created_at, new Date(m.created_at).getTime(), "💰", `Se acreditó saldo: +${formatoMoneda(mon, monto)} ${mon}.`);
  });
  return ev.filter((e) => e.t > corte).sort((a, b) => b.t - a.t).slice(0, 30);
}
function nhBadge() {
  const b = $("nh-btn"), c = $("nh-badge"); if (!b) return;
  b.hidden = !usuarioActual;
  if (!usuarioActual) return;
  const visto = nhLeer("visto", 0), n = nhEventos().filter((e) => e.t > visto).length;
  c.hidden = n === 0; c.textContent = n > 9 ? "9+" : String(n);
}
async function nhTraerMovs() {
  if (!usuarioActual) return;
  try {
    const { data, error } = await conTimeout(supabase.from("saldo_movimientos").select("created_at, moneda, monto").eq("user_id", usuarioActual.id).order("created_at", { ascending: false }).limit(10), 8000);
    if (!error && Array.isArray(data)) nhMovs = data;
  } catch (_) {}
}
function nhPintar() {
  const cont = $("nh-lista"); cont.replaceChildren();
  const ev = nhEventos(), visto = nhLeer("visto", 0);
  if (!ev.length) { const p = document.createElement("p"); p.className = "nh-vacio"; p.textContent = "Todavía no tenés notificaciones. Acá vas a ver cuando se acredite tu saldo, cuando tu orden esté en proceso o se acredite, y más."; cont.appendChild(p); return; }
  ev.forEach((e) => {
    const f = document.createElement("div"); f.className = "nh-item" + (e.t > visto ? " nuevo" : "");
    const i = document.createElement("span"); i.className = "nh-ic"; i.textContent = e.ic || "🔔";
    const c = document.createElement("div"), t = document.createElement("div"), h = document.createElement("small");
    t.className = "nh-t"; t.textContent = e.txt; h.textContent = fechaHora(e.t) + " · " + hace(new Date(e.t).toISOString());
    c.append(t, h); f.append(i, c); cont.appendChild(f);
  });
}
async function nhNombres() {   // trae el nombre de los IDs de tus compras (lo guarda el sistema al acreditar)
  const ids = [...new Set((comprasUsuario || []).slice(0, 10).map((o) => o.id_jugador && String(o.id_jugador)).filter(Boolean))].filter((i) => !nombreGuardado(i));
  await Promise.all(ids.map(async (i) => { try { const r = await conTimeout(Promise.resolve(supabase.rpc("nombre_id", { p_id: i })), 4000); if (r && r.data) recordarNombre(i, String(r.data)); } catch (_) {} }));
}
async function abrirNotifs() {
  if (!usuarioActual) return;
  $("nh-modal").hidden = false; nhPintar();
  await Promise.all([nhTraerMovs(), nhNombres()]); if (!$("nh-modal").hidden) nhPintar();
  nhGuardar("visto", Date.now()); nhBadge();
}
const cerrarNotifs = () => { $("nh-modal").hidden = true; nhBadge(); };
document.addEventListener("DOMContentLoaded", () => {
  $("nh-btn")?.addEventListener("click", abrirNotifs);
  $("nh-x")?.addEventListener("click", cerrarNotifs);
  $("nh-modal")?.addEventListener("click", (e) => { if (e.target.id === "nh-modal") cerrarNotifs(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("nh-modal").hidden) cerrarNotifs(); });
  $("nh-limpiar")?.addEventListener("click", () => { nhGuardar("corte", Date.now()); nhGuardar("log", []); nhPintar(); nhBadge(); });
  setInterval(nhBadge, 8000);
  setTimeout(() => { nhTraerMovs().then(nhBadge); }, 4000);
});
{
  const a0 = avisar;
  avisar = function (titulo, texto, o) { a0(titulo, texto, o); try { if (!esAdminActual()) {
      const todo = String(titulo || "") + " " + String(texto || "");
      if (/acreditamos saldo/i.test(todo)) anotarNotif("💰", "Se acreditó saldo: " + String(texto || "").replace(/\s*·\s*/g, " y "), "saldo_" + Math.floor(Date.now() / 600000));
      else { const m = String(titulo || "").match(/^(\S+)\s+(.*)$/su); anotarNotif(m ? m[1] : "🔔", (m ? m[2] : String(titulo || "")) + (texto ? " " + texto : "")); }
    }; } catch (_) {} };
  const b0 = avisarAcreditada;
  avisarAcreditada = function (x) { b0(x); try { anotarNotif("✅", `¡Tus ${x.paquete || "diamantes"} ya están acreditados!`, "o" + x.id + "_completada"); } catch (_) {} };
  const c0 = iniciarSeguimiento;
  iniciarSeguimiento = function (id, paquete, estado, visto) {
    c0(id, paquete, estado, visto);
    try { if (estado === "pendiente" || estado === "error_envio") anotarNotif("📨", `Tu orden de ${paquete || "diamantes"} fue enviada y está en proceso.`, "o" + id + "_env"); } catch (_) {}
  };
  const d0 = consultarSeguimiento;
  consultarSeguimiento = async function () {
    const s = seg, antes = s && s.estado; await d0();
    try { if (s && s.estado === "fallida" && antes !== "fallida") anotarNotif("↩️", `Tu orden de ${s.paquete || "diamantes"} no se pudo acreditar: tu saldo fue devuelto.`, "o" + s.id + "_fallida"); } catch (_) {}
  };
}

// =====================================================================
// v29: "Pendientes" del administrador + guía animada para clientes nuevos
// =====================================================================
async function hoyDatos() {
  const d = { chats: [], ords: [], stock: [], espera: [], modo: promoModo, segundos: promoSeg, hoyOk: 0, hoyDia: 0, err: [] };
  { const cfg = await promoConfig(null, null, true); if (cfg) { d.modo = !!cfg.activo; d.segundos = Number(cfg.segundos) || 90; } }
  resumenAdmin.forEach((r, id) => { if (r.noLeidos > 0) d.chats.push({ id, n: r.noLeidos, ultima: r.ultima }); });
  d.chats.sort((a, b) => b.ultima - a.ultima);
  try {
    let r = await conTimeout(supabase.from("ordenes_recarga").select("id,estado,envio_error,created_at,id_jugador,diamantes,promo_estado,promo_hasta").order("created_at", { ascending: false }).limit(60), 10000);
    if (r.error) r = await conTimeout(supabase.from("ordenes_recarga").select("id,estado,envio_error,created_at,id_jugador,diamantes").order("created_at", { ascending: false }).limit(60), 10000);
    if (r.error) throw r.error;
    const inicio = new Date(); inicio.setHours(0, 0, 0, 0);
    (r.data || []).forEach((o) => {
      if (o.promo_estado === "esperando" && o.estado === "pendiente") d.espera.push(o);
      else if (o.estado === "pendiente" || o.estado === "error_envio") d.ords.push(o);
      if (o.estado === "completada" && new Date(o.created_at) >= inicio) { d.hoyOk++; d.hoyDia += Number(o.diamantes) || 0; }
    });
  } catch (_) { d.err.push("órdenes"); }
  try {
    const r = await conTimeout(supabase.rpc("admin_stock_pines"), 10000);
    if (r.error) throw r.error;
    stockPaquetes = Array.isArray(r.data) ? r.data : stockPaquetes;
    d.stock = stockPaquetes.filter((p) => ETIQUETA_STOCK[p.paquete_id] && (Number(p.disponibles) || 0) <= limPk(p.paquete_id).pocos).map((p) => ({ nombre: ETIQUETA_STOCK[p.paquete_id], n: Number(p.disponibles) || 0 }));
  } catch (_) { d.err.push("stock"); }
  return d;
}
const hoyTotal = (d) => d.ords.length + d.stock.length + d.espera.length;
async function actualizarBadgeHoy() {
  if (!esAdminActual() || !document.body.classList.contains("modo-admin") || document.hidden) return;
  const d = await hoyDatos(), b = $("hoy-n"); if (!b) return;
  const n = hoyTotal(d); b.hidden = n === 0; b.textContent = n > 99 ? "99+" : String(n);
}
const nombresId = new Map();
async function nombreDeId(id) {
  if (nombresId.has(id)) return nombresId.get(id);
  try { const r = await conTimeout(Promise.resolve(supabase.rpc("nombre_id", { p_id: id })), 4000); if (r && r.data) { nombresId.set(id, String(r.data)); return String(r.data); } } catch (_) {}
  try {
    const res = await postWebhook({ tipo_evento: "VERIFICAR_JUGADOR", id_jugador: id, playerId: id, region: "SAC" }, 9000);
    if (!res.ok) return null;
    const info = normalizarJugador(await conTimeout(res.json(), 8000));
    const n = info && info.nombre ? String(info.nombre) : null;
    if (n) nombresId.set(id, n);
    return n;
  } catch (_) { return null; }
}
const fmtSeg = (n) => (n >= 60 ? Math.floor(n / 60) + " min" + (n % 60 ? " " + (n % 60) + " s" : "") : n + " s");
// Estado real del modo (viene del servidor). Si una respuesta quedó vieja por un cambio reciente, se ignora.
async function promoConfig(activo = null, segundos = null, latido = false) {
  const t0 = Date.now();
  try {
    const { data, error } = await supabase.rpc("admin_promo_config", { p_activo: activo, p_segundos: segundos, p_latido: latido });
    if (error) throw error;
    if (activo === null && t0 < promoCambioTs) return null;
    promoModo = !!(data && data.activo); promoSeg = Number(data && data.segundos) || 90;
    return data;
  } catch (e) { if (activo !== null) throw e; return null; }
}
// Recuerda los IDs que ya revisaste en Pago Store (sin descuento o ya usado): sus próximos pedidos salen directo con PIN, sin espera
function promoMarcarId(id, diamantes, resultado) { try { Promise.resolve(supabase.rpc("admin_promo_resultado", { p_id: String(id || ""), p_diamantes: Number(diamantes) || 0, p_resultado: resultado })).catch(() => {}); } catch (_) {} }
// Si salís de Pendientes o apagás: lo que esperaba sale al instante con tu PIN
async function promoApagarAuto() {
  clearTimeout(promoAusT); promoAusT = null;
  if (!promoModo) return;
  promoModo = false; promoCambioTs = Date.now();
  try { await promoConfig(false); mostrarAviso("Modo disponible apagado: los pedidos que esperaban salieron con tu PIN.", "info"); }
  catch (_) { promoModo = true; mostrarAviso("No pude apagar el modo disponible. Volvé a Pendientes y apagalo.", "error"); }
  promoCambioTs = Date.now();
}
// reloj de cada pedido en espera (cada segundo, sin consultar nada): barra y número cambian de verde a rojo
function promoTick() {
  document.querySelectorAll(".hoy-esp-fila").forEach((f) => {
    const hasta = Number(f.dataset.hasta), total = Math.max(1000, Number(f.dataset.total) || 90000);
    const ms = Math.max(0, hasta - Date.now()), seg = Math.ceil(ms / 1000), frac = Math.min(1, ms / total);
    const color = `hsl(${Math.round(125 * frac)} ${Math.round(72 + 28 * (1 - frac))}% ${frac < 0.3 ? 56 : 48}%)`;
    const cd = f.querySelector(".hoy-cd"), bar = f.querySelector(".hoy-barra i");
    if (cd) { cd.textContent = seg > 0 ? Math.floor(seg / 60) + ":" + String(seg % 60).padStart(2, "0") : "Enviando…"; cd.style.color = color; cd.classList.toggle("urge", frac < 0.22); }
    if (bar) { bar.style.width = (frac * 100).toFixed(1) + "%"; bar.style.background = color; bar.style.boxShadow = `0 0 ${Math.round((1 - frac) * 10)}px ${color}`; }
    if (ms <= 0 && !f.dataset.fin) {
      f.dataset.fin = "1"; f.classList.add("vencida");
      Promise.resolve(supabase.rpc("admin_promo_liberar")).catch(() => {}).then(() => setTimeout(() => { if (vistaAdmin === "hoy") pintarHoy(); }, 1500));
    }
  });
}
setInterval(promoTick, 1000);
// ---- Clientes registrados (hoy / total) con buscador
let cliDatos = null, cliTs = 0, cliCargando = false; const cliQ = { hoy: "", total: "" }, cliN = { hoy: 4, total: 4 };
async function cliCargar() {
  if (cliCargando) return; cliCargando = true;
  try {
    const ini = new Date(); ini.setHours(0, 0, 0, 0);
    const [l, t, h] = await Promise.all([
      supabase.from(CONFIG.TABLA_PERFILES).select("id,email,full_name,avatar_url,created_at").order("created_at", { ascending: false }).limit(500),
      supabase.from(CONFIG.TABLA_PERFILES).select("id", { count: "exact", head: true }),
      supabase.from(CONFIG.TABLA_PERFILES).select("id", { count: "exact", head: true }).gte("created_at", ini.toISOString()),
    ]);
    if (l.error) throw l.error;
    cliDatos = { filas: l.data || [], total: t.count != null ? t.count : (l.data || []).length, hoy: h.count != null ? h.count : 0, ini: ini.getTime() };
    cliTs = Date.now();
  } catch (_) { if (!cliDatos) cliDatos = { error: true, filas: [], total: 0, hoy: 0 }; }
  cliCargando = false;
}
function tarjetaClientes(abrirChat, modo) {
  const t = document.createElement("div"); t.className = "hoy-card info cli-card";
  const titulo = modo === "hoy" ? "Registrados hoy" : "Total de clientes", ico = modo === "hoy" ? "🆕" : "👥";
  const pintar = () => {
    const d = cliDatos; if (!d) return;
    const n = modo === "hoy" ? d.hoy : d.total;
    t.innerHTML = `<div class="hoy-cab"><span>${ico}</span><b>${titulo}</b><em></em></div><div class="cli-num"></div>
      <label class="cli-bus">🔍<input type="search" class="cli-q" placeholder="Buscar por nombre o mail" autocomplete="off"></label><div class="cli-lista"></div>`;
    t.querySelector("em").textContent = String(n); t.querySelector(".cli-num").textContent = n === 1 ? "1 cliente" : n + " clientes";
    const q = t.querySelector(".cli-q"); q.value = cliQ[modo] || "";
    if (modo === "hoy") q.closest("label").hidden = d.hoy < 7;
    const lista = t.querySelector(".cli-lista");
    const llenar = () => {
      lista.replaceChildren();
      const bus = (cliQ[modo] || "").trim().toLowerCase();
      let filas = d.filas.filter((f) => modo === "total" || new Date(f.created_at).getTime() >= d.ini);
      if (bus) filas = filas.filter((f) => ((f.full_name || "") + " " + (f.email || "")).toLowerCase().includes(bus));
      if (d.error) { const p = document.createElement("p"); p.className = "hoy-vacio"; p.textContent = "No se pudo leer la lista de clientes."; lista.appendChild(p); return; }
      if (!filas.length) { const p = document.createElement("p"); p.className = "hoy-vacio"; p.textContent = bus ? "Nadie coincide con esa búsqueda." : modo === "hoy" ? "Hoy todavía no se registró nadie." : "Sin clientes."; lista.appendChild(p); return; }
      const lim = cliN[modo];
      filas.slice(0, lim).forEach((f) => {
        const b = document.createElement("button"); b.type = "button"; b.className = "cli-fila";
        const nom = f.full_name || (f.email || "").split("@")[0] || "Cliente";
        const av = document.createElement("span"); av.className = "cli-av"; pintarAvatarEn(av, f.avatar_url, (nom[0] || "C").toUpperCase());
        const tx = document.createElement("span"); tx.className = "cli-tx"; tx.innerHTML = "<b></b><small></small>"; tx.firstChild.textContent = nom; tx.lastChild.textContent = f.email || "";
        const fe = document.createElement("em"); const ms = new Date(f.created_at).getTime(); fe.textContent = ms >= d.ini ? new Date(ms).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : new Date(ms).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
        b.append(av, tx, fe); b.title = "Abrir chat"; b.addEventListener("click", () => abrirChat(f.id)); lista.appendChild(b);
      });
      if (filas.length > lim) { const m = document.createElement("button"); m.type = "button"; m.className = "cli-mas"; m.textContent = `Ver más (${filas.length - lim})`; m.addEventListener("click", () => { cliN[modo] += 10; llenar(); }); lista.appendChild(m); }
      else if (lim > 4) { const m = document.createElement("button"); m.type = "button"; m.className = "cli-mas"; m.textContent = "Ver menos"; m.addEventListener("click", () => { cliN[modo] = 4; llenar(); }); lista.appendChild(m); }
    };
    llenar();
    q.addEventListener("input", () => { cliQ[modo] = q.value; cliN[modo] = 4; llenar(); });
  };
  if (cliDatos) pintar(); else t.innerHTML = `<div class="hoy-cab"><span>${ico}</span><b>${titulo}</b></div><p class="hoy-vacio">Cargando…</p>`;
  if (!cliDatos || Date.now() - cliTs > 60000) cliCargar().then(() => { if (t.isConnected && document.activeElement !== t.querySelector(".cli-q")) pintar(); });
  return t;
}
// ---- Límites de PINs (alarma urgente y "quedan pocos")
function tarjetaLimitesPin() {
  const t = document.createElement("div"); t.className = "hoy-card info lp-card";
  const NOM = Object.entries(ETIQUETA_STOCK);
  let modo = null;
  const pintar = () => {
    const l = JSON.parse(JSON.stringify(stockLim));
    t.innerHTML = `<div class="hoy-cab"><span>📦</span><b>Límites de PINs</b></div>
      <p class="hoy-mas">Elegí cuál querés ajustar.</p>
      <div class="lp-btns"><button type="button" data-m="alarma" class="${modo === "alarma" ? "on" : ""}"><strong>🚨 Alarma urgente</strong><small>Avisa al celular y por mail cuando quedan ${l.alarma} o menos</small></button>
      <button type="button" data-m="pocos" class="${modo === "pocos" ? "on" : ""}"><strong>⚠️ «Quedan pocos»</strong><small>Marca el aviso del Estado del sistema con ${l.pocos} o menos</small></button></div><div class="lp-panel"></div><button type="button" class="lp-prueba">🔔 Probar alarma en mis dispositivos</button><small class="lp-pr-n hoy-mas"></small>`;
    t.querySelector(".lp-prueba").addEventListener("click", async (ev) => {
      const bt = ev.currentTarget, nota = t.querySelector(".lp-pr-n"); bt.disabled = true;
      try { sfx("alarma"); if (navigator.vibrate) navigator.vibrate([600, 200, 600, 200, 900]); } catch (_) {}
      try {
        const { data, error } = await supabase.rpc("admin_push_prueba"); if (error) throw error;
        const n = Number(data) || 0;
        nota.textContent = n ? `Mandé la alarma a ${n} dispositivo${n > 1 ? "s" : ""} registrado${n > 1 ? "s" : ""}. Si cerraste la página, debería llegarte en unos segundos.` : "No tenés ningún dispositivo registrado para avisos. Abrí el menú ☰ en cada equipo y activá «Avisos».";
      } catch (e) { nota.textContent = /PGRST202|does not exist|42883/i.test(String(e.message || e.code)) ? "Falta ejecutar novedades_clientes_v35.sql en Supabase." : "No se pudo mandar la prueba."; }
      bt.disabled = false;
    });
    t.querySelectorAll(".lp-btns button").forEach((b) => b.addEventListener("click", () => { modo = modo === b.dataset.m ? null : b.dataset.m; pintar(); }));
    if (!modo) return;
    const p = t.querySelector(".lp-panel");
    const tit = modo === "alarma" ? "Avisarme con alarma cuando queden" : "Marcar «quedan pocos» cuando queden";
    p.innerHTML = `<label class="rp-f">${tit} <input type="number" class="rp-in lp-g" min="0" max="999" inputmode="numeric"> PIN o menos <small>(en todos los paquetes)</small></label>
      <details class="lp-det"><summary>Ajustar por paquete (opcional)</summary><div class="lp-filas"></div></details><button type="button" class="hoy-ir lp-gu">Guardar</button>`;
    const g = p.querySelector(".lp-g"); g.value = l[modo];
    const filas = p.querySelector(".lp-filas");
    NOM.forEach(([id, n]) => {
      const f = document.createElement("label"); f.className = "lp-fila"; f.innerHTML = `<span>${n} 💎</span><input type="number" class="rp-in lp-pk" min="0" max="999" inputmode="numeric" placeholder="general">`;
      const i = f.querySelector("input"); i.dataset.id = id; const v = l.pk && l.pk[id] && l.pk[id][modo]; if (v != null) i.value = v;
      filas.appendChild(f);
    });
    p.querySelector(".lp-gu").addEventListener("click", async (ev) => {
      const bt = ev.currentTarget; bt.disabled = true;
      const nuevo = JSON.parse(JSON.stringify(stockLim)); nuevo.pk = nuevo.pk || {};
      nuevo[modo] = Math.max(0, parseInt(g.value, 10) || 0);
      p.querySelectorAll(".lp-pk").forEach((i) => { const id = i.dataset.id; nuevo.pk[id] = nuevo.pk[id] || {}; if (i.value === "") delete nuevo.pk[id][modo]; else nuevo.pk[id][modo] = Math.max(0, parseInt(i.value, 10) || 0); });
      try {
        const { data, error } = await supabase.rpc("admin_stock_limites", { p: nuevo }); if (error) throw error;
        stockLim = { alarma: Number(data.alarma), pocos: Number(data.pocos), pk: data.pk || {} };
        mostrarAviso("Límites guardados.", "ok"); modo = null; pintar(); try { stockVigilar(); } catch (_) {}
      } catch (e) { mostrarAviso(/PGRST202|does not exist|42883/i.test(String(e.message || e.code)) ? "Falta ejecutar novedades_clientes_v34.sql en Supabase." : "No se pudo guardar.", "error"); bt.disabled = false; }
    });
  };
  pintar();
  stockLimCargar().then(() => { if (t.isConnected && !modo) pintar(); });
  return t;
}
// ---- Reglas de nombre y foto (días entre cambios)
function tarjetaReglasPerfil() {
  const t = document.createElement("div"); t.className = "hoy-card info rp-card";
  t.innerHTML = `<div class="hoy-cab"><span>⚙️</span><b>Nombre y foto de clientes</b></div>
    <p class="hoy-mas">Cada cuántos días puede cambiar un cliente su nombre y su foto. Poné 0 para que no haya límite.</p>
    <label class="rp-f">✏️ Cambiar nombre cada <input type="number" class="rp-in rp-a" min="0" max="365" inputmode="numeric"> días</label>
    <label class="rp-f">📷 Cambiar foto cada <input type="number" class="rp-in rp-f2" min="0" max="365" inputmode="numeric"> días</label>
    <button type="button" class="hoy-ir rp-g">Guardar</button>`;
  const a = t.querySelector(".rp-a"), f = t.querySelector(".rp-f2"), g = t.querySelector(".rp-g");
  a.value = "30"; f.value = "30";
  Promise.resolve(supabase.rpc("perfil_reglas")).then((r) => { const d = r && r.data; if (d && document.activeElement !== a && document.activeElement !== f) { a.value = d.alias_dias; f.value = d.foto_dias; } }).catch(() => {});
  g.addEventListener("click", async () => {
    g.disabled = true;
    try {
      const { error } = await supabase.rpc("admin_perfil_reglas", { p_alias_dias: Math.max(0, parseInt(a.value, 10) || 0), p_foto_dias: Math.max(0, parseInt(f.value, 10) || 0) });
      if (error) throw error; mostrarAviso("Guardado: nombre cada " + (parseInt(a.value, 10) || 0) + " días, foto cada " + (parseInt(f.value, 10) || 0) + " días.", "ok");
    } catch (e) { mostrarAviso(/PGRST202|does not exist|42883/i.test(String(e.message || e.code)) ? "Falta ejecutar novedades_clientes_v32.sql en Supabase." : "No se pudo guardar.", "error"); }
    g.disabled = false;
  });
  return t;
}
let hoyMasAbierto = false;
async function pintarHoy() {
  const c = $("hoy-cont"); if (!c) return;
  const mi = ++hoySeq;
  const d = await hoyDatos(); if (mi !== hoySeq || vistaAdmin !== "hoy") return;
  const b = $("hoy-n"); if (b) { const n = hoyTotal(d); b.hidden = n === 0; b.textContent = String(n); }
  if (document.activeElement && document.activeElement.classList && (document.activeElement.classList.contains("hoy-seg-in") || document.activeElement.classList.contains("hoy-aus-in") || document.activeElement.classList.contains("cli-q") || document.activeElement.classList.contains("rp-in") || document.activeElement.classList.contains("lp-g") || document.activeElement.classList.contains("lp-pk"))) return;   // no te saco del casillero mientras escribís
  const filasPrevias = new Map([...c.querySelectorAll(".hoy-esp-fila")].map((f) => [f.dataset.id, f]));   // se reutilizan: la barra no parpadea
  promoUltModo = d.modo;
  c.replaceChildren();
  const tarjeta = (ico, titulo, n, tono, filas, vacio, irA) => {
    const t = document.createElement("div"); t.className = "hoy-card " + (n ? tono : "ok");
    const cab = document.createElement("div"); cab.className = "hoy-cab";
    cab.innerHTML = `<span>${ico}</span><b></b><em></em>`; cab.querySelector("b").textContent = titulo; cab.querySelector("em").textContent = n ? String(n) : "✓";
    t.appendChild(cab);
    if (!n) { const p = document.createElement("p"); p.className = "hoy-vacio"; p.textContent = vacio; t.appendChild(p); }
    filas.slice(0, 5).forEach(([txt, sub, fn]) => { const f = document.createElement("button"); f.type = "button"; f.className = "hoy-fila"; f.innerHTML = "<span></span><small></small>"; f.firstChild.textContent = txt; f.lastChild.textContent = sub; f.addEventListener("click", fn); t.appendChild(f); });
    if (filas.length > 5) { const m = document.createElement("small"); m.className = "hoy-mas"; m.textContent = `y ${filas.length - 5} más…`; t.appendChild(m); }
    if (n && irA) { const g = document.createElement("button"); g.type = "button"; g.className = "hoy-ir"; g.textContent = irA[0]; g.addEventListener("click", irA[1]); t.appendChild(g); }
    return t;
  };
  const abrirChat = (id) => { mostrarVistaAdmin("clientes"); const f = clientesAdmin.find((x) => x[CONFIG.COL_ID] === id); if (f) seleccionarCliente(f, etiquetaCliente(id)); };
  const minOrd = (o) => { const m = Math.max(0, Math.round((Date.now() - new Date(o.created_at).getTime()) / 60000)); return m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`; };
  // --- modo "Estoy disponible" (compra manual con descuento)
  const caja = document.createElement("div"); caja.className = "hoy-promo" + (d.modo ? " on" : "");
  caja.innerHTML = `<div class="hoy-promo-t"><b>💸 Compras con descuento (Pago Store)</b><label class="hoy-sw"><input type="checkbox" class="hoy-sw-in"><span></span></label></div><p class="hoy-promo-d"></p><label class="hoy-seg">⏱ Segundos que espera cada pedido <input type="number" class="hoy-seg-in" min="15" max="600" step="5" inputmode="numeric"> <small></small></label><label class="hoy-seg">🚪 Si me voy de esta pantalla, se apaga a los <input type="number" class="hoy-aus-in" min="5" max="600" step="5" inputmode="numeric"> s <small>Los pedidos que esperaban salen con PIN.</small></label>`;
  const chk = caja.querySelector(".hoy-sw-in"); chk.checked = !!d.modo;
  const segInp = caja.querySelector(".hoy-seg-in");
  const ausInp = caja.querySelector(".hoy-aus-in"); ausInp.value = promoAusSeg();
  ausInp.addEventListener("input", () => { const v = parseInt(ausInp.value, 10); if (v >= 5 && v <= 600) { try { localStorage.setItem("zarela_promo_ausente", String(v)); } catch (_) {} } });
  segInp.value = d.modo ? d.segundos : promoSegBorrador; segInp.disabled = !!d.modo;
  segInp.addEventListener("input", () => { const v = parseInt(segInp.value, 10); if (v > 0) promoSegBorrador = v; });
  caja.querySelector(".hoy-seg small").textContent = d.modo ? "Fijo mientras esté prendido. Para cambiarlo, apagá y volvé a prender." : "Elegilo antes de prender (15 a 600).";
  caja.querySelector(".hoy-promo-d").textContent = d.modo
    ? `ESTÁS DISPONIBLE: cada pedido nuevo espera hasta ${fmtSeg(d.segundos)} acá (cada uno con su propio reloj). Si lo comprás vos con descuento, apretá «Ya la cargué». Si no hacés nada, sale solo con tu PIN. Si apagás o salís de Pendientes, lo que esté esperando sale con PIN al instante. La primera compra de cada ID sale siempre con PIN. Desde la segunda te llega acá, salvo ese paquete que ya resolviste («Ya la cargué» o «Mandar con PIN» una vez).`
    : "Apagado: todos los pedidos salen al instante con tus PIN. Prendelo cuando estés frente a la compu y quieras aprovechar el 50 %.";
  { const pd = caja.querySelector(".hoy-promo-d"); pd.title = "Tocá para leer todo"; pd.addEventListener("click", () => pd.classList.toggle("abierto")); }
  chk.addEventListener("change", async () => {
    const quiere = chk.checked;
    chk.disabled = true; segInp.disabled = true;
    promoCambioTs = Date.now();
    try {
      const seg = Math.max(15, Math.min(600, parseInt(segInp.value, 10) || 90));
      promoSegBorrador = seg;
      await promoConfig(quiere, quiere ? seg : null);
      mostrarAviso(quiere ? `Disponible: cada pedido espera ${fmtSeg(seg)} por vos.` : "Apagado: lo que esperaba salió con PIN y todo sale al instante.", "ok");
    } catch (e) { chk.checked = !quiere; mostrarAviso(/PGRST202|does not exist|42883/i.test(String(e.message || e.code)) ? "Falta ejecutar novedades_clientes_v22.sql en Supabase." : "No se pudo cambiar.", "error"); }
    promoCambioTs = Date.now();
    pintarHoy();
  });
  c.appendChild(caja);
  const nvb = document.createElement("button"); nvb.type = "button"; nvb.className = "hoy-nov"; nvb.innerHTML = "<span>🎁</span><b>Novedades: Historias, Cupones, Puntos y Chats</b><small>Prender / apagar · revisar fotos y mensajes ›</small>";
  nvb.addEventListener("click", () => mostrarVistaAdmin("novedades")); c.appendChild(nvb);
  if (d.espera.length) {
    const w = document.createElement("div"); w.className = "hoy-espera";
    d.espera.forEach((o) => {
      const previa = filasPrevias.get(String(o.id));
      if (previa) { previa.dataset.hasta = new Date(o.promo_hasta).getTime(); w.appendChild(previa); return; }
      const f = document.createElement("div"); f.className = "hoy-esp-fila"; f.dataset.id = o.id;
      f.dataset.hasta = new Date(o.promo_hasta).getTime();
      f.dataset.total = Math.max(1000, new Date(o.promo_hasta).getTime() - new Date(o.created_at || Date.now()).getTime());
      f.innerHTML = `<div class="hoy-esp-i"><div class="hoy-esp-id"><b></b><button type="button" class="hoy-copiar" title="Copiar el ID" aria-label="Copiar el ID">📋</button><span class="hoy-nom"></span></div><small></small><div class="hoy-barra"><i></i></div></div><div class="hoy-cd"></div><button type="button" class="hoy-ok">✅ Ya la cargué</button><button type="button" class="hoy-pin">🚀 Mandar con PIN</button>`;
      f.querySelector("b").textContent = `#${o.id} · ${o.diamantes || "?"} 💎 · ID ${o.id_jugador}`;
      f.querySelector("small").textContent = `Pago Store → República Dominicana → ese ID → ${o.diamantes} → PayPal. Si no tiene descuento o no podés, tocá «Mandar con PIN».`;
      f.querySelector(".hoy-copiar").addEventListener("click", async () => { try { await navigator.clipboard.writeText(String(o.id_jugador)); mostrarAviso("ID copiado: " + o.id_jugador, "ok"); } catch (_) { mostrarAviso("No se pudo copiar.", "error"); } });
      nombreDeId(o.id_jugador).then((n) => { const e = f.querySelector(".hoy-nom"); if (e && n) e.textContent = "· " + n; });
      f.querySelector(".hoy-ok").addEventListener("click", async () => { const { error } = await supabase.rpc("admin_promo_cargada", { p_orden_id: o.id }); if (!error) promoMarcarId(o.id_jugador, o.diamantes, "cargado"); mostrarAviso(error ? "No se pudo cerrar (¿ya salió con PIN?)." : "Listo: orden acreditada y el PIN volvió a tu stock.", error ? "error" : "ok"); pintarHoy(); });
      f.querySelector(".hoy-pin").addEventListener("click", async (ev) => { const bt = ev.currentTarget; if (bt.disabled) return; f.querySelectorAll("button").forEach((x) => { x.disabled = true; }); const { error } = await supabase.rpc("admin_promo_mandar_pin", { p_orden_id: o.id }); if (error) f.querySelectorAll("button").forEach((x) => { x.disabled = false; }); else promoMarcarId(o.id_jugador, o.diamantes, "pin"); mostrarAviso(error ? "No se pudo enviar." : "Enviada con PIN. (Se envía una sola vez)", error ? "error" : "ok"); pintarHoy(); });
      w.appendChild(f);
    });
    c.appendChild(w);
  }
  const grid = document.createElement("div"); grid.className = "hoy-grid";
  grid.append(
    tarjetaClientes(abrirChat, "hoy"),
    tarjeta("🧾", "Órdenes por atender", d.ords.length, "alto", d.ords.map((o) => [`#${o.id} · ${o.diamantes || "?"} 💎 · ID ${o.id_jugador || "-"}`, (/REVISAR A MANO/i.test(o.envio_error || "") ? "⚠ revisar a mano · " : o.estado === "error_envio" ? "no llegó a n8n · " : "") + minOrd(o), () => mostrarVistaAdmin("ordenes")]), "Todas las órdenes están al día.", ["Ir a Órdenes", () => mostrarVistaAdmin("ordenes")]),
    tarjeta("📦", "Stock de PIN bajo", d.stock.length, "aviso", d.stock.map((p) => [`Paquete ${p.nombre} 💎`, p.n === 0 ? "sin PIN" : `quedan ${p.n}`, () => mostrarVistaAdmin("stock")]), "Hay PIN suficientes en todos los paquetes.", ["Ir a Stock", () => mostrarVistaAdmin("stock")]),
  );
  const hoy = document.createElement("div"); hoy.className = "hoy-card info";
  hoy.innerHTML = `<div class="hoy-cab"><span>📈</span><b>Hoy</b></div><p class="hoy-num"></p><small class="hoy-mas">Contado sobre tus últimas 60 órdenes.</small><button type="button" class="hoy-ir">🩺 Revisar errores y cómo arreglarlos</button>`;
  hoy.querySelector(".hoy-num").textContent = `${d.hoyOk} recarga${d.hoyOk === 1 ? "" : "s"} acreditada${d.hoyOk === 1 ? "" : "s"} · ${fmtNum(d.hoyDia)} 💎`;
  hoy.querySelector(".hoy-ir").addEventListener("click", () => { try { abrirSalud(); } catch (_) {} });
  c.appendChild(grid);
  const mas = document.createElement("details"); mas.className = "hoy-masdet"; mas.open = hoyMasAbierto;
  const sm = document.createElement("summary"); sm.textContent = "⚙️ Más datos y herramientas"; mas.appendChild(sm);
  mas.addEventListener("toggle", () => { hoyMasAbierto = mas.open; });
  const g2 = document.createElement("div"); g2.className = "hoy-grid";
  g2.append(hoy, tarjetaLimitesPin(), tarjetaAvisosWa(), tarjetaClientes(abrirChat, "total"), tarjetaReglasPerfil());
  mas.appendChild(g2); c.appendChild(mas);
  if (d.err.length) { const p = document.createElement("p"); p.className = "hoy-mas"; p.textContent = "No se pudo leer: " + d.err.join(", ") + ". Tocá 🔄 para reintentar."; c.appendChild(p); }
  if (!hoyTotal(d) && !d.err.length) { const ok = document.createElement("p"); ok.className = "hoy-todo"; ok.textContent = "✅ Todo al día. No tenés nada pendiente."; c.prepend(ok); }
  promoTick();
  const r = document.createElement("button"); r.type = "button"; r.className = "hoy-refrescar"; r.textContent = "🔄 Actualizar"; r.addEventListener("click", pintarHoy); c.appendChild(r);
}
setInterval(() => { if (vistaAdmin === "hoy" && !document.hidden) pintarHoy(); else actualizarBadgeHoy(); }, 30000);
document.addEventListener("DOMContentLoaded", () => setTimeout(actualizarBadgeHoy, 6000));

// ---- Guía animada de bienvenida
(function guiaBienvenida() {
  const K = "zarela_tour_visto";
  const sec2 = () => document.querySelectorAll("section.card.cristal")[1] || null;
  const PASOS = [
    { t: "¡Bienvenido a Zarela! 💎", d: "Te mostramos lo básico en 30 segundos. Después seguís vos solo." },
    { t: "Tu saldo", d: "Acá ves tu saldo en pesos y en dólares. Con él comprás tus diamantes.", sel: () => document.querySelector(".saldo-badges") },
    { t: "Cargá saldo", d: "Tocá «Cargar saldo», elegí Mercado Pago o Binance, pagá y mandá la captura por el chat.", sel: () => document.querySelector(".btn-cargar-saldo") },
    { t: "1 · Tu ID de Free Fire", d: "Escribí tu ID y tocá Verificar: te mostramos tu nombre para que no te equivoques.", sel: () => $("player-id")?.closest(".card") },
    { t: "2 · Elegí tu paquete", d: "Elegí cómo pagar, tocá el paquete que querés y listo: los diamantes llegan a tu cuenta.", sel: () => document.querySelector(".bonoxs-card")?.parentElement || sec2() },
    { t: "¿Dudas? Escribinos", d: "Desde este botón nos escribís, mandás tu comprobante y te respondemos.", sel: () => { const f = $("chat-fab"); if (f && f.getClientRects().length && getComputedStyle(f).display !== "none") return f; const m = $("chat-messages-container"); return (m && (m.closest(".chat-v2") || m.parentElement)) || null; } },
  ];
  let i = 0, abierto = false, raf = 0;
  const E = (id) => document.getElementById(id);
  const marcar = () => { try { localStorage.setItem(K, "1"); } catch (_) {} };
  function posicionar() {
    if (!abierto) return;
    const p = PASOS[i], el = p.sel && p.sel(), foco = E("tour-foco"), mano = E("tour-mano"), card = E("tour-card");
    const r = el && el.getBoundingClientRect();
    if (!r || r.width < 4 || r.height < 4) {
      foco.style.cssText = "left:50%;top:50%;width:0;height:0"; mano.style.display = "none";
      card.style.cssText = "left:50%;top:50%;transform:translate(-50%,-50%)";
    } else {
      const m = 6;
      foco.style.cssText = `left:${r.left - m}px;top:${r.top - m}px;width:${r.width + m * 2}px;height:${r.height + m * 2}px`;
      const abajo = r.top + r.height / 2 < innerHeight * 0.55;
      const ch = card.offsetHeight || 150, ancho = Math.min(340, innerWidth - 24);
      let top = abajo ? r.bottom + 58 : r.top - ch - 58;
      top = Math.max(12, Math.min(innerHeight - ch - 12, top));
      const left = Math.max(12, Math.min(innerWidth - ancho - 12, r.left + r.width / 2 - ancho / 2));
      card.style.cssText = `left:${left}px;top:${top}px;width:${ancho}px;transform:none`;
      mano.style.display = "block"; mano.textContent = abajo ? "👆" : "👇";
      mano.style.left = Math.max(8, Math.min(innerWidth - 40, r.left + r.width / 2 - 14)) + "px";
      mano.style.top = (abajo ? r.bottom + 8 : r.top - 44) + "px";
    }
  }
  const loop = () => { posicionar(); raf = abierto ? requestAnimationFrame(loop) : 0; };
  function mostrar() {
    const p = PASOS[i], el = p.sel && p.sel();
    if (el && el.scrollIntoView) { try { const r = el.getBoundingClientRect(); if (r.top < 70 || r.bottom > innerHeight - 70) el.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (_) {} }
    E("tour-t").textContent = p.t; E("tour-d").textContent = p.d;
    E("tour-sig").textContent = i === PASOS.length - 1 ? "¡Listo!" : "Siguiente";
    E("tour-atras").style.visibility = i === 0 ? "hidden" : "visible";
    E("tour-saltar").style.visibility = i === PASOS.length - 1 ? "hidden" : "visible";
    E("tour-pts").innerHTML = PASOS.map((_, k) => `<i class="${k === i ? "on" : ""}"></i>`).join("");
  }
  function abrir() {
    if (abierto) return;
    try { cerrarTodosLosModales && cerrarTodosLosModales(); if ($("sidebar-menu")?.classList.contains("open")) toggleMenu(); } catch (_) {}
    i = 0; abierto = true; E("tour").hidden = false; document.body.classList.add("tour-on"); mostrar();
    if (!raf) raf = requestAnimationFrame(loop);
  }
  function pista(el, txt, ms, flecha) {
    if (!el || !el.getClientRects().length) return;
    const r = el.getBoundingClientRect(), h = document.createElement("div"); h.className = "tour-pista";
    h.innerHTML = `<i>${flecha}</i><span></span>`; h.lastChild.textContent = txt;
    const izq = Math.max(8, Math.min(innerWidth - 190, r.left));
    h.style.cssText = `left:${izq}px;top:${r.bottom + 6}px`;
    document.body.appendChild(h); setTimeout(() => { h.classList.add("chau"); setTimeout(() => h.remove(), 400); }, ms);
  }
  window.pistaTutorial = pista;
  function cerrar(salto) {
    const ultimo = i >= PASOS.length - 1;
    abierto = false; E("tour").hidden = true; document.body.classList.remove("tour-on"); marcar();
    if (salto === true && !ultimo) {   // si lo saltó: una flechita corta (no molesta) le dice dónde volver a verlo
      try { localStorage.setItem("zarela_tour_salto", "1"); } catch (_) {}
      setTimeout(() => pista(document.querySelector(".menu-toggle-btn"), "¿Lo saltaste sin querer? Tutorial: entrá acá", 3600, "↖"), 400);
    }
  }
  window.abrirTutorial = abrir;
  document.addEventListener("DOMContentLoaded", () => {
    E("tour-sig")?.addEventListener("click", () => { if (i >= PASOS.length - 1) cerrar(); else { i++; mostrar(); } });
    E("tour-atras")?.addEventListener("click", () => { if (i > 0) { i--; mostrar(); } });
    E("tour-saltar")?.addEventListener("click", () => cerrar(true));
    document.addEventListener("keydown", (e) => { if (abierto && e.key === "Escape") cerrar(true); });
    // al abrir el menú después de saltar la guía: la manito señala "Ver tutorial" un ratito
    const menu = E("sidebar-menu");
    if (menu) new MutationObserver(() => {
      let f = false; try { f = localStorage.getItem("zarela_tour_salto") === "1"; } catch (_) {}
      if (!f || !menu.classList.contains("open")) return;
      try { localStorage.removeItem("zarela_tour_salto"); } catch (_) {}
      const b = E("sb-tutorial"); if (b) setTimeout(() => { b.scrollIntoView({ block: "nearest" }); pista(b, "Acá está el tutorial", 3200, "👆"); b.classList.add("sb-resalta"); setTimeout(() => b.classList.remove("sb-resalta"), 3400); }, 500);
    }).observe(menu, { attributes: true, attributeFilter: ["class"] });
    E("sb-tutorial")?.addEventListener("click", () => setTimeout(abrir, 250));
    // primera visita: se muestra sola una vez (no a la administradora)
    setTimeout(() => {
      let visto = false; try { visto = localStorage.getItem(K) === "1"; } catch (_) {}
      if (visto || document.body.classList.contains("modo-admin") || esAdminActual() || location.hash.includes("access_token")) return;
      // sin cuenta enlazada: primero la guía de «Enlazar con Google» (después de enlazar se muestra este tutorial)
      if (!usuarioActual) return;
      abrir();
    }, 2500);
  });
})();


// ---- Tiempo real: Supabase avisa al instante (mensajes, saldo, órdenes); el sondeo de siempre queda de respaldo
let rtCanal = null, rtUid = null, rtT = {};
function rtDebounce(k, fn) { clearTimeout(rtT[k]); rtT[k] = setTimeout(() => { try { fn(); } catch (_) {} }, 350); }
function iniciarTiempoReal() {
  try {
    if (typeof supabase.channel !== "function") return;
    const uid = usuarioActual ? usuarioActual.id : null;
    if (uid === rtUid) return;
    if (rtCanal) { try { supabase.removeChannel(rtCanal); } catch (_) {} rtCanal = null; }
    rtUid = uid; if (!uid) return;
    const ch = supabase.channel("zarela-" + uid), admin = esAdminActual();
    const on = (tabla, filtro, fn, evento = "*") => ch.on("postgres_changes", { event: evento, schema: "public", table: tabla, ...(filtro ? { filter: filtro } : {}) }, fn);
    if (admin) {
      on(MSG.tabla, null, () => { rtDebounce("m", () => { if (clienteSel) refrescarMensajes(false); cargarPanelAdmin(true); }); });
      on("ordenes_recarga", null, () => rtDebounce("o", () => { cargarOrdenesAdmin(true); actualizarBadgeHoy(); }));
    } else {
      on(MSG.tabla, `${MSG.userCol}=eq.${uid}`, () => rtDebounce("m", () => cargarHistorialCliente(false)));
      on(CONFIG.TABLA_PERFILES, `${CONFIG.COL_ID}=eq.${uid}`, () => rtDebounce("s", () => cargarSaldo(usuarioActual)), "UPDATE");
      on("ordenes_recarga", `user_id=eq.${uid}`, () => rtDebounce("o", () => { consultarSeguimiento(); cargarSaldo(usuarioActual); if (comprasAbierto()) cargarHistorialCompras(true); else cargarHistorialCompras(true); }));
    }
    ch.subscribe();
    rtCanal = ch;
  } catch (e) { console.warn("Tiempo real no disponible:", e && e.message); }
}
setInterval(iniciarTiempoReal, 4000);   // se (re)conecta solo cuando cambia la sesión


// ---- vigilante del modo "Estoy disponible": avisa con sonido cuando entra un pedido que espera tu compra
async function promoVigilar() {
  if (!esAdminActual() || !document.body.classList.contains("modo-admin") || promoOcupado) return;
  promoOcupado = true;
  try {
    const cfg = await promoConfig(null, null, true);   // también es el "latido": avisa que tu panel sigue abierto
    if (!cfg) return;
    if (promoUltModo !== null && promoUltModo !== promoModo && vistaAdmin === "hoy") { pintarHoy(); }
    if (!promoModo) return;
    const r = await supabase.from("ordenes_recarga").select("id,id_jugador,diamantes,promo_hasta").eq("promo_estado", "esperando").eq("estado", "pendiente");
    if (r.error) return;
    const nuevas = (r.data || []).filter((o) => !promoVistas.has(o.id));
    nuevas.forEach((o) => promoVistas.add(o.id));
    if (nuevas.length) { avisar("💸 Pedido esperando tu compra:", `${nuevas[0].diamantes} 💎 · ID ${nuevas[0].id_jugador}`, { tipo: "info" }); if (vistaAdmin !== "hoy") { const b = $("hoy-n"); if (b) { b.hidden = false; b.textContent = String((r.data || []).length); } } }
    if (vistaAdmin === "hoy") {   // solo se vuelve a dibujar si cambió la lista de pedidos esperando
      const enPantalla = [...document.querySelectorAll(".hoy-esp-fila")].map((f) => f.dataset.id).sort().join(",");
      const enServidor = (r.data || []).map((o) => String(o.id)).sort().join(",");
      if (enPantalla !== enServidor) pintarHoy();
    }
  } catch (_) {} finally { promoOcupado = false; }
}
setInterval(promoVigilar, 5000);


// =====================================================================
// v33: "escribiendo…" (como WhatsApp) y estado de soporte (en línea / desconectada / oculto)
// =====================================================================
let tipCanal = null, tipNombre = null, tipUlt = 0, tipTimer = null;
const tipYo = () => (esAdminActual() && document.body.classList.contains("modo-admin") ? "admin" : "cliente");
function tipIndicador() {
  const admin = tipYo() === "admin";
  let el = $("tip-ind"); if (el && el.dataset.lado === (admin ? "a" : "c") && el.isConnected) return el;
  if (el) el.remove();
  const ancla = admin ? document.querySelector("#admin-chat-view .adm-resp") : document.querySelector("#chat-widget .chat-input-area");
  if (!ancla || !ancla.parentNode) return null;
  el = document.createElement("div"); el.id = "tip-ind"; el.className = "tip-ind"; el.hidden = true; el.dataset.lado = admin ? "a" : "c";
  el.innerHTML = '<span class="tip-quien"></span><span class="tip-pts"><i></i><i></i><i></i></span>';
  ancla.parentNode.insertBefore(el, ancla);
  return el;
}
function tipMostrar(on) {
  const el = tipIndicador(); if (!el) return;
  clearTimeout(tipTimer);
  if (!on) { el.hidden = true; return; }
  el.querySelector(".tip-quien").textContent = tipYo() === "admin" ? ((clienteSel && clienteSel.etiqueta) || "El cliente") + " está escribiendo" : "Alma Zarela está escribiendo";
  el.hidden = false;
  const cont = tipYo() === "admin" ? $("admin-msgs") : $("chat-messages-container"); if (cont) { try { cont.scrollTop = cont.scrollHeight; } catch (_) {} }
  tipTimer = setTimeout(() => { el.hidden = true; }, 4500);
}
function tipSincronizar() {
  try {
    if (typeof supabase.channel !== "function") return;
    const admin = tipYo() === "admin";
    const id = admin ? (clienteSel && clienteSel.id) : (usuarioActual && usuarioActual.id);
    const nombre = id ? "typ-" + id : null;
    if (nombre === tipNombre) return;
    if (tipCanal) { try { supabase.removeChannel(tipCanal); } catch (_) {} tipCanal = null; }
    tipNombre = nombre; tipMostrar(false);
    if (!nombre) return;
    tipCanal = supabase.channel(nombre, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "tip" }, ({ payload }) => { if (payload && payload.de && payload.de !== tipYo()) tipMostrar(payload.s === 1); })
      .subscribe();
  } catch (e) { /* sin tiempo real: simplemente no se ve el "escribiendo" */ }
}
function tipEnviar(s) {
  try { if (tipCanal) tipCanal.send({ type: "broadcast", event: "tip", payload: { de: tipYo(), s } }); } catch (_) {}
}
setInterval(tipSincronizar, 1500);
document.addEventListener("input", (e) => {
  const t = e.target; if (!t || (t.id !== "chat-user-input" && t.id !== "admin-respuesta")) return;
  if (!t.value.trim()) { tipUlt = 0; tipEnviar(0); return; }
  if (Date.now() - tipUlt > 2500) { tipUlt = Date.now(); tipEnviar(1); }
});
const tipFin = () => { tipUlt = 0; tipEnviar(0); };
document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target && (e.target.id === "chat-user-input" || e.target.id === "admin-respuesta")) tipFin(); }, true);
document.addEventListener("click", (e) => { if (e.target.closest && e.target.closest(".btn-send, #admin-btn-responder")) tipFin(); }, true);

let soporteEstado = "en_linea", soporteCanal = null, soporteBase = "en_linea", servidorLento = false;
const SOPORTE_TXT = { en_linea: "✔ Oficial · En línea", desconectada: "✔ Oficial · Desconectada", oculto: "" };
function pintarSoporte(base) {
  if (!Object.prototype.hasOwnProperty.call(SOPORTE_TXT, base)) base = "en_linea";
  soporteBase = base;
  const e = (servidorLento && base !== "oculto") ? "desconectada" : base;   // recargas demoradas (compu apagada): se ve "Desconectada" sola
  soporteEstado = e;
  if (e === "en_linea") { try { $("chat-aviso-off")?.remove(); } catch (_) {} }
  const w = $("chat-widget"); if (w) w.dataset.soporte = e;
  const t = $("chat-soporte-txt"); if (t) { t.innerHTML = e === "oculto" ? "" : '<span class="of-tag">✔ Oficial</span> · ' + (e === "en_linea" ? "En línea" : "Desconectada"); t.hidden = e === "oculto"; }
  const sel = $("adm-soporte"); if (sel && sel.value !== base && document.activeElement !== sel) sel.value = base;
}
async function leerSoporte() { try { const { data, error } = await supabase.rpc("soporte_estado"); if (!error && data) pintarSoporte(String(data)); } catch (_) {} }
function soporteConectar() {
  try {
    if (soporteCanal || typeof supabase.channel !== "function") return;
    soporteCanal = supabase.channel("soporte-estado", { config: { broadcast: { self: true } } })
      .on("broadcast", { event: "e" }, ({ payload }) => { if (payload && typeof payload.e === "string") pintarSoporte(payload.e); })
      .subscribe();
  } catch (_) {}
}
document.addEventListener("change", async (ev) => {
  if (!ev.target || ev.target.id !== "adm-soporte") return;
  const e = ev.target.value;
  try {
    const { error } = await supabase.rpc("admin_soporte_estado", { p_estado: e });
    if (error) throw error;
    pintarSoporte(e);
    try { if (soporteCanal) soporteCanal.send({ type: "broadcast", event: "e", payload: { e } }); } catch (_) {}
    mostrarAviso(e === "en_linea" ? "Tus clientes te ven en línea." : e === "desconectada" ? "Tus clientes te ven desconectada." : "Tus clientes no ven ningún estado.", "ok");
  } catch (err) { mostrarAviso(/PGRST202|does not exist|42883/i.test(String(err.message || err.code)) ? "Falta ejecutar novedades_clientes_v22.sql en Supabase." : "No se pudo cambiar el estado.", "error"); leerSoporte(); }
});
async function soporteLatido() { if (!esAdminActual()) return; try { await supabase.rpc("admin_soporte_latido"); } catch (_) {} }   // "estoy en la página": sin esto, "En línea" no se muestra
setInterval(soporteLatido, 30000); setTimeout(soporteLatido, 4000);
setTimeout(() => { soporteConectar(); leerSoporte(); }, 2500);
setInterval(leerSoporte, 30000);


// =====================================================================
// v35: sonidos suaves (sintetizados, sin archivos) con botón para silenciar
// =====================================================================
let stockLim = { alarma: 1, pocos: 3, pk: {} };
const limPk = (id) => { const o = (stockLim.pk && stockLim.pk[id]) || {}; return { alarma: o.alarma != null ? Number(o.alarma) : Number(stockLim.alarma), pocos: o.pocos != null ? Number(o.pocos) : Number(stockLim.pocos) }; };
async function stockLimCargar() { try { const r = await conTimeout(Promise.resolve(supabase.rpc("stock_limites")), 6000); if (r && r.data && typeof r.data === "object") stockLim = { alarma: Number(r.data.alarma), pocos: Number(r.data.pocos), pk: r.data.pk || {} }; } catch (_) {} }
let sfxCtx = null, sfxUlt = 0;
const sfxActivo = () => { try { return localStorage.getItem("zarela_sfx") !== "0"; } catch (_) { return true; } };
function sfxTono(c, t0, f1, f2, dur, vol, tipo = "sine") {
  const o = c.createOscillator(), g = c.createGain();
  o.type = tipo; o.frequency.setValueAtTime(f1, t0); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.02);
}
function sfx(nombre) {
  if (!sfxActivo() && nombre !== "alarma") return;   // la alarma de stock suena aunque silencies los sonidos
  const ahora = Date.now(); if (nombre === "tap" && ahora - sfxUlt < 70) return; sfxUlt = ahora;   // el toque nunca pisa a otro sonido
  try {
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    sfxCtx = sfxCtx || new C(); if (sfxCtx.state === "suspended") sfxCtx.resume();
    const c = sfxCtx, t = c.currentTime + 0.005;
    if (nombre === "abrir") { sfxTono(c, t, 440, 660, 0.12, 0.05); sfxTono(c, t + 0.07, 660, 880, 0.14, 0.04); }
    else if (nombre === "cerrar") { sfxTono(c, t, 660, 400, 0.12, 0.045); }
    else if (nombre === "ok") { sfxTono(c, t, 523, null, 0.1, 0.05); sfxTono(c, t + 0.08, 659, null, 0.1, 0.05); sfxTono(c, t + 0.16, 784, null, 0.18, 0.05); }
    else if (nombre === "alarma") { for (let i = 0; i < 6; i++) sfxTono(c, t + i * 0.34, i % 2 ? 660 : 990, i % 2 ? 640 : 960, 0.3, 0.16, "square"); }
    else if (nombre === "registro") { sfxTono(c, t, 784, null, 0.12, 0.04); sfxTono(c, t + 0.1, 1047, null, 0.2, 0.035); }
    else if (nombre === "error") { sfxTono(c, t, 220, 160, 0.2, 0.05, "triangle"); }
    else { sfxTono(c, t, 900, 700, 0.045, 0.03); }   // tap
  } catch (_) {}
}
// toque suave en los botones principales (no en cada elemento: solo los que son botones de verdad)
document.addEventListener("click", (e) => {
  const b = e.target.closest && e.target.closest("button, .admin-tab, .sb-accion, a.btn-cargar-saldo, .carousel-btn");
  if (!b || b.disabled || b.getAttribute("aria-disabled") === "true" || b.id === "sb-sfx") return;
  const t0 = Date.now();
  setTimeout(() => { if (sfxUlt < t0) sfx("tap"); }, 30);   // si el clic abrió algo, ya sonó su sonido y el toque se omite
}, true);
function pintarSfxMenu() {
  const b = document.getElementById("sb-sfx"); if (!b) return;
  const on = sfxActivo(); b.setAttribute("aria-pressed", String(on));
  const ico = b.querySelector(".sb-ico"), sm = b.querySelector("small");
  if (ico) ico.textContent = on ? "🔊" : "🔇"; if (sm) { sm.textContent = on ? "✓ Activados" : "Silenciados"; sm.classList.toggle("sb-okv", on); }
}
document.addEventListener("click", (e) => {
  if (!e.target.closest || !e.target.closest("#sb-sfx")) return;
  try { localStorage.setItem("zarela_sfx", sfxActivo() ? "0" : "1"); } catch (_) {}
  pintarSfxMenu(); sfx("ok");
});
document.addEventListener("DOMContentLoaded", pintarSfxMenu);
setTimeout(pintarSfxMenu, 1500);


// =====================================================================
// v41: pausar animaciones fuera de pantalla / con la pestaña oculta (celulares más livianos)
// =====================================================================
(function pausarAnimaciones() {
  const R = document.documentElement;
  const oculto = () => R.classList.toggle("z-oculto", document.hidden);
  document.addEventListener("visibilitychange", oculto); oculto();
  if (!("IntersectionObserver" in window)) return;
  const io = new IntersectionObserver((es) => es.forEach((e) => e.target.classList.toggle("z-fuera", !e.isIntersecting)), { rootMargin: "120px 0px" });
  const ver = () => document.querySelectorAll("header.navbar, .hero-banner-section, section.card, footer").forEach((el) => { if (!el.dataset.zobs) { el.dataset.zobs = "1"; io.observe(el); } });
  ver(); setTimeout(ver, 3000); setInterval(ver, 15000);
})();

// =====================================================================
// v41: "Mi nombre en el Top" (único por persona)
// =====================================================================
function ejemploAlias(u) {   // ejemplo sacado del propio nombre de Google o del mail del cliente (nunca el de otra persona)
  const m = (u && u.user_metadata) || {};
  const tomar = (t) => { const w = String(t || "").split(/[\s._\-+0-9]+/).find((x) => /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,}$/.test(x)); return w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ""; };
  return tomar(m.full_name || m.name) || tomar(String((u && u.email) || "").split("@")[0]) || ["Pablito 5", "Gamer 7", "Estrella 12"][Math.floor(Math.random() * 3)];
}
async function abrirAlias() {
  if (!usuarioActual) return;
  try { if ($("sidebar-menu")?.classList.contains("open")) toggleMenu(); } catch (_) {}
  const m = $("al-modal"); if (!m) return;
  m.hidden = false; $("al-nota").textContent = ""; $("al-ok").disabled = false;
  const inp = $("al-in");
  inp.value = ""; inp.disabled = false; $("al-prev").textContent = nombreCompleto(usuarioActual);
  aliasFotoPintar((usuarioActual.user_metadata || {}).avatar_url || (usuarioActual.user_metadata || {}).picture || "");
  inp.placeholder = "Ej: " + ejemploAlias(usuarioActual);
  try {
    const r = await conTimeout(Promise.resolve(supabase.rpc("mi_alias")), 6000);
    const d = r && r.data;
    if (d) {
      inp.value = d.alias || String(d.nombre || "").slice(0, 20);
      aliasFotoPintar(d.avatar || "");
      $("al-prev").textContent = d.nombre || nombreCompleto(usuarioActual);
      if (d.puede_foto === false) { const bf = $("al-foto-b"); if (bf) { bf.disabled = true; bf.title = "Podés cambiarla el " + new Date(d.proximo_foto).toLocaleDateString("es-AR"); } $("al-foto-n").textContent = "Podés cambiar tu foto el " + new Date(d.proximo_foto).toLocaleDateString("es-AR") + "."; }
      else { const bf = $("al-foto-b"); if (bf) bf.disabled = false; $("al-foto-n").textContent = ""; }
      if (d.puede === false) { inp.disabled = true; $("al-ok").disabled = true; $("al-nota").textContent = "Ya cambiaste tu nombre hace poco. Podés volver a cambiarlo el " + new Date(d.proximo).toLocaleDateString("es-AR") + "."; }
    }
  } catch (_) {}
  setTimeout(() => { try { inp.focus(); } catch (_) {} }, 50);
}
function cerrarAlias() { const m = $("al-modal"); if (m) m.hidden = true; }
function aliasPrevia() { const v = ($("al-in")?.value || "").trim(); if ($("al-prev")) $("al-prev").textContent = v || (usuarioActual ? nombreCompleto(usuarioActual) : ""); }
async function guardarAlias() {
  const v = ($("al-in").value || "").trim(), nota = $("al-nota"), ok = $("al-ok");
  if (v.length < 3) { nota.textContent = "Escribí al menos 3 letras."; return; }
  ok.disabled = true; nota.textContent = "Guardando…";
  try {
    const { error } = await conTimeout(Promise.resolve(supabase.rpc("mi_alias_guardar", { p_alias: v })), 8000);
    if (error) {
      const t = String(error.message || "");
      if (/ALIAS_OCUPADO/.test(t)) nota.textContent = `Ese nombre ya lo usa otra persona. Probá con «${v.slice(0, 16)} ${Math.floor(Math.random() * 90 + 10)}».`;
      else if (/ALIAS_INVALIDO/.test(t)) nota.textContent = "Usá de 3 a 20 letras o números (puede tener espacios, punto, guion). Sin links ni símbolos raros.";
      else if (/ALIAS_RESERVADO/.test(t)) nota.textContent = "Ese nombre está reservado. Elegí otro.";
      else if (/ALIAS_ESPERA/.test(t)) nota.textContent = "Ya cambiaste tu nombre hace poco. Probá más adelante.";
      else if (/PGRST202|does not exist|42883/.test(t + (error.code || ""))) nota.textContent = "Esta función todavía no está disponible. Probá más tarde.";
      else nota.textContent = "No pudimos guardarlo. Probá de nuevo en un momento.";
      ok.disabled = false; return;
    }
    aplicarNombrePropio(v);
    mostrarAviso("¡Listo! Ahora te ven como «" + v + "» en el Top.", "ok");
    cerrarAlias();
  } catch (_) { nota.textContent = "No pudimos guardarlo. Revisá tu conexión."; ok.disabled = false; }
}
document.addEventListener("DOMContentLoaded", () => { $("al-x")?.addEventListener("click", cerrarAlias); $("al-modal")?.addEventListener("click", (e) => { if (e.target.id === "al-modal") cerrarAlias(); }); $("al-in")?.addEventListener("input", aliasPrevia); $("al-in")?.addEventListener("keydown", (e) => { if (e.key === "Enter") guardarAlias(); }); $("al-ok")?.addEventListener("click", guardarAlias); });
Object.assign(window, { abrirAlias });
// =====================================================================
// v50: aviso opcional al cliente cuando se acredita su recarga (mail O WhatsApp) + lista de WhatsApp para vos
// =====================================================================
async function abrirAviso() {
  if (!usuarioActual) return;
  try { if ($("sidebar-menu")?.classList.contains("open")) toggleMenu(); } catch (_) {}
  const m = $("av-modal"); if (!m) return;
  m.hidden = false; $("av-nota").textContent = ""; $("av-in").value = ""; $("av-no").hidden = true;
  if ($("av-mail-d")) $("av-mail-d").textContent = usuarioActual.email || "tu cuenta de Google";
  try {
    const r = await conTimeout(Promise.resolve(supabase.rpc("mi_aviso")), 6000);
    const d = r && r.data;
    if (d && d.via === "whatsapp" && d.valor) { $("av-in").value = "+" + d.valor; $("av-no").hidden = false; $("av-nota").textContent = "Ya lo tenés activado."; }
  } catch (_) {}
}
function cerrarAviso() { const m = $("av-modal"); if (m) m.hidden = true; }
async function guardarAviso(via, valor) {
  const nota = $("av-nota"); nota.textContent = "Guardando…";
  try {
    const { error } = await conTimeout(Promise.resolve(supabase.rpc("mi_aviso_guardar", { p_via: via, p_valor: valor })), 8000);
    if (error) {
      const t = String(error.message || "");
      nota.textContent = /AVISO_INVALIDO/.test(t) ? "Revisá el número: poné código de país y número, solo dígitos." : /PGRST202|does not exist|42883/.test(t + (error.code || "")) ? "Esta función todavía no está disponible. Probá más tarde." : "No pudimos guardarlo. Probá de nuevo.";
      return;
    }
    if (via) { nota.textContent = "¡Listo! Además del mail, te escribimos por WhatsApp."; $("av-no").hidden = false; }
    else { nota.textContent = "Listo, quitamos el WhatsApp. El mail sigue activo."; $("av-in").value = ""; $("av-no").hidden = true; }
  } catch (_) { nota.textContent = "No pudimos guardarlo. Probá de nuevo."; }
}
document.addEventListener("DOMContentLoaded", () => {
  $("av-x")?.addEventListener("click", cerrarAviso);
  $("av-modal")?.addEventListener("click", (e) => { if (e.target.id === "av-modal") cerrarAviso(); });
  $("av-ok")?.addEventListener("click", () => guardarAviso("whatsapp", ($("av-in").value || "").trim()));
  $("av-in")?.addEventListener("keydown", (e) => { if (e.key === "Enter") guardarAviso("whatsapp", ($("av-in").value || "").trim()); });
  $("av-no")?.addEventListener("click", () => guardarAviso("ninguno", ""));
});
Object.assign(window, { abrirAviso });


// =====================================================================
// v51: cambiar de cuenta, opiniones solo para quienes recargaron, invitación a opinar, enlace de estado
// =====================================================================
const CUENTAS_KEY = "zarela_cuentas";
const cuentasLeer = () => { try { const a = JSON.parse(localStorage.getItem(CUENTAS_KEY) || "[]"); return Array.isArray(a) ? a : []; } catch (_) { return []; } };
const cuentasGuardar = (a) => { try { localStorage.setItem(CUENTAS_KEY, JSON.stringify(a.slice(0, 3))); } catch (_) {} };
function cuentaRecordar(session) {
  if (!session || !session.user) return;
  const u = session.user;
  const a = cuentasLeer().filter((x) => x.id !== u.id);
  a.unshift({ id: u.id, email: u.email || "", nombre: nombreCompleto(u), foto: fotoDe(u) || "", at: session.access_token, rt: session.refresh_token });
  cuentasGuardar(a);
}
function cuentaOlvidar(id) { cuentasGuardar(cuentasLeer().filter((x) => x.id !== id)); }
async function cambiarCuenta(id) {
  const c = cuentasLeer().find((x) => x.id === id); if (!c) return;
  mostrarAviso("Cambiando de cuenta…", "ok");
  try {
    const { data } = await supabase.auth.getSession(); if (data && data.session) cuentaRecordar(data.session);
    const { error } = await supabase.auth.setSession({ access_token: c.at, refresh_token: c.rt }); if (error) throw error;
    setTimeout(() => location.reload(), 200);
  } catch (_) { cuentaOlvidar(id); pintarCuentas(); mostrarAviso("Esa cuenta venció. Volvé a agregarla con «Agregar otra cuenta».", "error"); }
}
async function agregarCuenta() {
  try {
    const { data } = await supabase.auth.getSession(); if (data && data.session) cuentaRecordar(data.session);
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: "select_account" } } });
    if (error) throw error;
  } catch (_) { mostrarAviso("No se pudo abrir el inicio de sesión.", "error"); }
}
let cuentasAbiertas = false;
function pintarCuentas() {
  const dentro = $("sb-cuentas"), fuera = $("sb-cuentas-out"); if (!dentro || !fuera) return;
  const lista = cuentasLeer(), actual = usuarioActual ? usuarioActual.id : null;
  const otras = lista.filter((x) => x.id !== actual);
  const box = actual ? dentro : fuera, otro = actual ? fuera : dentro;
  otro.hidden = true; otro.replaceChildren();
  const perfil = $("sb-perfil"); if (perfil) { perfil.classList.toggle("abre", !!actual); perfil.setAttribute("role", actual ? "button" : ""); perfil.tabIndex = actual ? 0 : -1; perfil.classList.toggle("abierto", !!actual && cuentasAbiertas); }
  if (!actual && !otras.length) { box.hidden = true; box.replaceChildren(); return; }
  box.hidden = actual ? !cuentasAbiertas : false; box.replaceChildren();
  const t = document.createElement("div"); t.className = "cu-tit"; t.textContent = actual ? "Tus cuentas en este dispositivo" : "Entrar con una cuenta guardada"; box.appendChild(t);
  const fila = (c, esActual) => {
    const r = document.createElement("div"); r.className = "cu-fila" + (esActual ? " on" : "");
    const av = document.createElement("span"); av.className = "cu-av"; if (c.foto) av.style.backgroundImage = `url("${String(c.foto).replace(/["\\)]/g, "")}")`; else av.textContent = (c.nombre || c.email || "?").slice(0, 1).toUpperCase();
    const tx = document.createElement("span"); tx.className = "cu-tx"; const n = document.createElement("b"); n.textContent = c.nombre || c.email; const s = document.createElement("small"); s.textContent = esActual ? "✓ Cuenta activa" : (c.email || "Tocá para entrar");
    tx.append(n, s); r.append(av, tx);
    if (!esActual) {
      r.tabIndex = 0; r.addEventListener("click", () => cambiarCuenta(c.id));
      const q = document.createElement("button"); q.type = "button"; q.className = "cu-q"; q.title = "Quitar de este dispositivo"; q.textContent = "✕";
      q.addEventListener("click", (e) => { e.stopPropagation(); cuentaOlvidar(c.id); pintarCuentas(); }); r.appendChild(q);
    }
    return r;
  };
  if (actual) { const yo = lista.find((x) => x.id === actual) || { nombre: nombreCompleto(usuarioActual), email: usuarioActual.email, foto: fotoDe(usuarioActual) }; box.appendChild(fila(yo, true)); }
  otras.forEach((c) => box.appendChild(fila(c, false)));
  if (lista.length < 3) {
    const ad = document.createElement("button"); ad.type = "button"; ad.className = "cu-add"; ad.textContent = "➕ Agregar otra cuenta"; ad.addEventListener("click", agregarCuenta); box.appendChild(ad);
  }
}
document.addEventListener("DOMContentLoaded", () => {
  const p = $("sb-perfil"); if (!p) return;
  const tog = () => { if (!usuarioActual) return; cuentasAbiertas = !cuentasAbiertas; pintarCuentas(); };
  p.addEventListener("click", tog); p.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tog(); } });
});
supabase.auth.onAuthStateChange((_e, session) => { if (session) cuentaRecordar(session); setTimeout(pintarCuentas, 80); });
document.addEventListener("DOMContentLoaded", () => setTimeout(pintarCuentas, 300));
Object.assign(window, { cambiarCuenta, agregarCuenta });

// ---- Opiniones: ¿ya recargó?
async function opCargarPuede() {
  if (!usuarioActual) { opPuede = null; return; }
  try { const r = await conTimeout(Promise.resolve(supabase.rpc("mi_recarga_ok")), 6000); opPuede = r && !r.error ? !!r.data : null; } catch (_) { opPuede = null; }
  try { renderOpiniones(); } catch (_) {}
}
supabase.auth.onAuthStateChange((_e, session) => { if (session) setTimeout(opCargarPuede, 400); else { opPuede = null; } });

// ---- Invitación a opinar 2 minutos después de acreditada la recarga
const OPINV_KEY = "zarela_opinv";
async function opInvitar() {
  try {
    if (!usuarioActual || document.hidden) return;
    if (opiniones.some((o) => o.user_id === usuarioActual.id)) return;
    const st = opInvEstado();   // v58: se pide como mucho 2 veces en total; si tocó «opinar» o ya opinó, nunca más
    if (st.listo || st.veces >= 2 || (st.veces === 1 && Date.now() - st.ult < 14 * 86400000)) return;
    const { data } = await supabase.from("ordenes_recarga").select("id,updated_at").eq("user_id", usuarioActual.id).eq("estado", "completada").order("updated_at", { ascending: false }).limit(1);
    const o = data && data[0]; if (!o) return;
    const edad = Date.now() - new Date(o.updated_at).getTime(); if (edad < 120000 || edad > 86400000) return;
    let vistos = []; try { vistos = JSON.parse(localStorage.getItem(OPINV_KEY) || "[]"); } catch (_) {}
    if (vistos.includes(o.id)) return;
    const el = $("op-inv"); if (!el) return; el.dataset.id = o.id; el.hidden = false;
  } catch (_) {}
}
const opInvClave = () => "zarela_opinv2_" + (usuarioActual ? usuarioActual.id : "x");
function opInvEstado() { try { return Object.assign({ veces: 0, ult: 0, listo: false }, JSON.parse(localStorage.getItem(opInvClave()) || "{}")); } catch (_) { return { veces: 0, ult: 0, listo: false }; } }
function opInvGuardar(st) { try { localStorage.setItem(opInvClave(), JSON.stringify(st)); } catch (_) {} }
function opInvCerrar(acepto) {
  const el = $("op-inv"); if (!el) return; const id = Number(el.dataset.id); el.hidden = true;
  { const st = opInvEstado(); if (acepto === true) st.listo = true; else { st.veces += 1; st.ult = Date.now(); } opInvGuardar(st); }
  try { const v = JSON.parse(localStorage.getItem(OPINV_KEY) || "[]"); if (id && !v.includes(id)) v.push(id); localStorage.setItem(OPINV_KEY, JSON.stringify(v.slice(-30))); } catch (_) {}
}
document.addEventListener("DOMContentLoaded", () => {
  $("op-inv-x")?.addEventListener("click", () => opInvCerrar(false));
  $("op-inv-ok")?.addEventListener("click", () => {
    opInvCerrar(true);
    const f = $("op-form") || $("comments-list"); try { f.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (_) {}
    setTimeout(() => { try { $("op-texto")?.focus(); } catch (_) {} }, 500);
  });
  setInterval(opInvitar, 45000); setTimeout(opInvitar, 25000);
});

// ---- Compartir el estado de un pedido (enlace público sin datos personales)
async function compartirEstado(id, btn) {
  const base = btn.textContent; btn.disabled = true;
  try {
    const { data, error } = await supabase.rpc("mi_orden_enlace", { p_id: id }); if (error || !data) throw error || new Error("sin token");
    const url = location.origin + location.pathname + "?pedido=" + data;
    if (navigator.share) { try { await navigator.share({ title: "Estado de mi recarga", text: "Mirá el estado de mi recarga de diamantes 💎", url }); btn.disabled = false; return; } catch (e) { if (e && e.name === "AbortError") { btn.disabled = false; return; } } }
    try { await navigator.clipboard.writeText(url); btn.textContent = "✓ Enlace copiado"; } catch (_) { window.prompt("Copiá este enlace:", url); }
    setTimeout(() => { btn.textContent = base; btn.disabled = false; }, 2200);
  } catch (e) {
    mostrarAviso(/PGRST202|does not exist|42883/i.test(String((e && (e.message || e.code)) || "")) ? "Falta ejecutar novedades_clientes_v37.sql en Supabase." : "No se pudo crear el enlace.", "error");
    btn.disabled = false;
  }
}
function pedidoPublicoIniciar() {
  const tk = new URLSearchParams(location.search).get("pedido");
  if (!tk || !/^[0-9a-f-]{36}$/i.test(tk)) return;
  const m = $("pd-modal"); if (!m) return; m.hidden = false;
  let timer = null;
  const cerrar = () => { m.hidden = true; clearTimeout(timer); try { history.replaceState(null, "", location.pathname); } catch (_) {} };
  $("pd-x")?.addEventListener("click", cerrar); $("pd-cta")?.addEventListener("click", (e) => { e.preventDefault(); cerrar(); });
  m.addEventListener("click", (e) => { if (e.target.id === "pd-modal") cerrar(); });
  const pintar = async () => {
    let d = null;
    try { const r = await conTimeout(Promise.resolve(supabase.rpc("estado_pedido", { p_token: tk })), 8000); d = r && r.data; } catch (_) {}
    const est = $("pd-est"), det = $("pd-det"); if (m.hidden) return;
    if (!d) { est.textContent = "No encontramos este pedido"; est.className = "pd-est mal"; det.textContent = "Revisá que el enlace esté completo."; return; }
    if (d.estado === "completada") { est.textContent = "✅ Acreditada"; est.className = "pd-est ok"; det.textContent = `Los ${d.diamantes} 💎 ya llegaron. Reiniciá Free Fire y revisá tu cuenta.`; return; }
    if (d.estado === "fallida") { est.textContent = "⚠️ No se pudo completar"; est.className = "pd-est mal"; det.textContent = "La persona que hizo el pedido puede escribirnos por el chat para resolverlo."; return; }
    est.textContent = "⏳ En proceso"; est.className = "pd-est wait"; det.textContent = `Se está acreditando una recarga de ${d.diamantes} 💎. Suele tardar alrededor de 1 minuto. Esta pantalla se actualiza sola.`;
    timer = setTimeout(pintar, 8000);
  };
  pintar();
}
document.addEventListener("DOMContentLoaded", pedidoPublicoIniciar);
Object.assign(window, { compartirEstado });

// Tarjeta del panel: avisos de WhatsApp para mandar con un toque
function tarjetaAvisosWa() {
  const t = document.createElement("div"); t.className = "hoy-card info";
  t.innerHTML = `<div class="hoy-cab"><span>💬</span><b>Avisos por WhatsApp</b></div><p class="hoy-num wa-n">…</p><small class="hoy-mas wa-m">Clientes que pidieron que les avises por WhatsApp cuando se acredita su recarga.</small><div class="wa-lista"></div>`;
  const lista = t.querySelector(".wa-lista");
  const pintar = async () => {
    try {
      const { data, error } = await supabase.rpc("admin_avisos_wa"); if (error) throw error;
      const f = Array.isArray(data) ? data : [];
      t.querySelector(".wa-n").textContent = f.length ? `${f.length} por enviar` : "Ninguno pendiente";
      lista.innerHTML = "";
      f.forEach((x) => {
        const b = document.createElement("button"); b.type = "button"; b.className = "hoy-ir wa-bt";
        b.textContent = `Enviar a +${x.tel} · orden #${x.orden}`;
        b.addEventListener("click", async () => {
          window.open(`https://wa.me/${x.tel}?text=${encodeURIComponent(x.texto)}`, "_blank", "noopener");
          try { await supabase.rpc("admin_aviso_wa_marcar", { p_id: x.id }); } catch (_) {}
          pintar();
        });
        lista.appendChild(b);
      });
    } catch (e) { t.querySelector(".wa-n").textContent = "—"; t.querySelector(".wa-m").textContent = /PGRST202|does not exist|42883/i.test(String(e.message || e.code)) ? "Falta ejecutar novedades_clientes_v36.sql en Supabase." : "No se pudo leer la lista."; }
  };
  pintar(); return t;
}



// =====================================================================
// v43: foto de perfil propia (se achica a 256 px y se sube sola)
// =====================================================================
const esFotoPropia = (u) => /\/storage\/v1\/object\/public\/avatares\//.test(String(u || ""));
function pintarAvatarEn(el, url, inicial) {
  if (!el) return;
  el.replaceChildren();
  if (/^https:\/\//.test(url || "")) { const im = document.createElement("img"); im.alt = ""; im.referrerPolicy = "no-referrer"; im.src = url; im.addEventListener("error", () => { im.remove(); el.textContent = inicial; }); el.appendChild(im); }
  else el.textContent = inicial;
}
function aliasFotoPintar(url) {
  const ini = (nombreCompleto(usuarioActual)[0] || "A").toUpperCase();
  pintarAvatarEn($("al-av"), url, ini);
  const q = $("al-foto-q"); if (q) q.hidden = !esFotoPropia(url);
}
function aplicarNombrePropio(n) {   // el nombre que eligió para el Top se ve también en el menú
  n = String(n || "").trim(); if (!n) return;
  const a = $("sb-nombre"); if (a) a.textContent = n;
  const b = $("cu-nombre"); if (b) b.textContent = n;
  const ini = (n[0] || "A").toUpperCase(), av = $("sb-avatar"); if (av && !av.querySelector("img")) av.textContent = ini;
}
function aplicarFotoPropia(url) {
  const ini = (nombreCompleto(usuarioActual)[0] || "A").toUpperCase();
  pintarAvatarEn($("sb-avatar"), url, ini); pintarAvatarEn($("cu-av"), url, ini); aliasFotoPintar(url);
}
async function cargarFotoPropia() {   // si ya subió una foto propia, se usa en vez de la de Google
  if (!usuarioActual) return;
  try {
    const { data } = await conTimeout(supabase.from(CONFIG.TABLA_PERFILES).select("avatar_url,full_name,alias").eq(CONFIG.COL_ID, usuarioActual.id).maybeSingle(), 8000);
    if (data && esFotoPropia(data.avatar_url)) aplicarFotoPropia(data.avatar_url);
    if (data && data.alias) aplicarNombrePropio(data.alias);
  } catch (_) {}
}
setInterval(() => { if (usuarioActual && !usuarioActual._fotoOk) { usuarioActual._fotoOk = true; cargarFotoPropia(); } }, 1200);
function achicarFoto(file) {
  return new Promise((ok, mal) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => {
      try {
        const L = 256, c = document.createElement("canvas"); c.width = L; c.height = L;
        const lado = Math.min(im.naturalWidth, im.naturalHeight), sx = (im.naturalWidth - lado) / 2, sy = (im.naturalHeight - lado) / 2;
        c.getContext("2d").drawImage(im, sx, sy, lado, lado, 0, 0, L, L);
        c.toBlob((b) => { URL.revokeObjectURL(url); b ? ok(b) : mal(new Error("blob")); }, "image/jpeg", 0.85);
      } catch (e) { mal(e); }
    };
    im.onerror = () => { URL.revokeObjectURL(url); mal(new Error("imagen")); };
    im.src = url;
  });
}
async function subirFotoPerfil(file) {
  const nota = $("al-nota");
  if (!file || !/^image\//.test(file.type)) { nota.textContent = "Elegí una imagen (JPG, PNG o WebP)."; return; }
  nota.textContent = "Subiendo tu foto…";
  try {
    const blob = await achicarFoto(file), ruta = usuarioActual.id + ".jpg";
    const { error: e1 } = await supabase.storage.from("avatares").upload(ruta, blob, { contentType: "image/jpeg", upsert: true });
    if (e1) throw e1;
    const pub = supabase.storage.from("avatares").getPublicUrl(ruta).data.publicUrl + "?v=" + Date.now();
    const { error: e2 } = await supabase.rpc("mi_avatar_guardar", { p_url: pub });
    if (e2) throw e2;
    aplicarFotoPropia(pub); nota.textContent = ""; mostrarAviso("¡Listo! Ya tenés tu foto.", "ok");
  } catch (e) {
    const t = String((e && e.message) || "") + String((e && e.code) || "");
    nota.textContent = /AVATAR_ESPERA/.test(t) ? "Ya cambiaste tu foto hace poco. Podés volver a cambiarla más adelante."
      : /AVATAR_SIN_COMPRA/.test(t) ? "La foto propia se habilita con tu primera recarga acreditada. Mientras tanto se usa la de tu cuenta de Google."
      : /Bucket not found|PGRST202|42883/i.test(t) ? "Esta función todavía no está disponible. Probá más tarde."
      : "No pudimos subir la foto. Probá con otra imagen.";
  }
}
async function quitarFotoPerfil() {
  try {
    const { error } = await supabase.rpc("mi_avatar_quitar"); if (error) throw error;
    const md = usuarioActual.user_metadata || {}; aplicarFotoPropia(md.avatar_url || md.picture || "");
    mostrarAviso("Volviste a la foto de tu cuenta de Google.", "ok");
  } catch (_) { $("al-nota").textContent = "No pudimos quitar la foto. Probá de nuevo."; }
}
document.addEventListener("DOMContentLoaded", () => {
  $("al-foto-b")?.addEventListener("click", () => $("al-file")?.click());
  $("al-file")?.addEventListener("change", (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; subirFotoPerfil(f); });
  $("al-foto-q")?.addEventListener("click", quitarFotoPerfil);
});


// =====================================================================
// v45: ALARMA cuando queda 1 PIN (o 0) y aviso suave de cliente nuevo (con la página abierta; con la página cerrada avisa el push)
// =====================================================================
function avisoDeEscritorio(titulo, cuerpo, tag, urgente) {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted" || !document.hidden) return;
    new Notification(titulo, { body: cuerpo, icon: "icon-192.png", tag, renotify: true, requireInteraction: !!urgente, vibrate: urgente ? [600, 200, 600, 200, 600, 200, 900] : [120, 60, 120] });
  } catch (_) {}
}
function alarmaStock(lista) {
  const txt = lista.map((p) => (Number(p.disponibles) === 0 ? "SIN PINs de " : "Quedan " + Number(p.disponibles) + " PIN de ") + ETIQUETA_STOCK[p.paquete_id] + " 💎").join(" · ");
  try { sfx("alarma"); setTimeout(() => sfx("alarma"), 2300); } catch (_) {}
  try { if (navigator.vibrate) navigator.vibrate([600, 200, 600, 200, 600, 200, 900]); } catch (_) {}
  try { mostrarAviso("🚨 " + txt + ". Cargá stock.", "error"); } catch (_) {}
  avisoDeEscritorio("🚨 Stock de PIN", txt, "stock-alarma", true);
}
async function stockVigilar() {
  if (!esAdminActual()) return;
  try {
    await stockLimCargar();
    const { data, error } = await conTimeout(Promise.resolve(supabase.rpc("admin_stock_pines")), 10000);
    if (error || !Array.isArray(data)) return;
    let prev = {}; try { prev = JSON.parse(localStorage.getItem("zarela_stock_prev") || "{}"); } catch (_) {}
    const ahora = {}, avisar = [];
    data.filter((p) => ETIQUETA_STOCK[p.paquete_id]).forEach((p) => {
      const n = Number(p.disponibles) || 0; ahora[p.paquete_id] = n;
      const antes = prev[p.paquete_id];
      const la = limPk(p.paquete_id).alarma;
      if (n > 0 && n <= la && (antes === undefined || antes > la)) avisar.push(p);
      else if (n === 0 && typeof antes === "number" && antes > 0) avisar.push(p);
    });
    let ult = 0; try { ult = Number(localStorage.getItem("zarela_stock_ult") || 0); } catch (_) {}
    if (!avisar.length && Date.now() - ult > 1800000) data.filter((p) => ETIQUETA_STOCK[p.paquete_id] && Number(p.disponibles) > 0 && Number(p.disponibles) <= limPk(p.paquete_id).alarma).forEach((p) => avisar.push(p));   // recordatorio cada 30 min mientras siga en 1
    try { localStorage.setItem("zarela_stock_prev", JSON.stringify(ahora)); } catch (_) {}
    if (avisar.length) { try { localStorage.setItem("zarela_stock_ult", String(Date.now())); } catch (_) {} alarmaStock(avisar); }
  } catch (_) {}
}
setInterval(stockVigilar, 20000); setTimeout(stockVigilar, 6000);

async function clientesNuevosVigilar() {
  if (!esAdminActual()) return;
  try {
    const [t, u] = await Promise.all([
      supabase.from(CONFIG.TABLA_PERFILES).select("id", { count: "exact", head: true }),
      supabase.from(CONFIG.TABLA_PERFILES).select("full_name,email").order("created_at", { ascending: false }).limit(1),
    ]);
    if (t.error || t.count == null) return;
    let prev = null; try { prev = localStorage.getItem("zarela_cli_total"); } catch (_) {}
    try { localStorage.setItem("zarela_cli_total", String(t.count)); } catch (_) {}
    if (prev !== null && t.count > Number(prev)) {
      const f = (u.data || [])[0] || {}, nom = f.full_name || (f.email || "").split("@")[0] || "Alguien";
      try { sfx("registro"); } catch (_) {}
      try { mostrarAviso("👋 Nuevo cliente: " + nom, "info"); } catch (_) {}
      avisoDeEscritorio("👋 Nuevo cliente", nom, "cliente-nuevo", false);
    }
  } catch (_) {}
}
setInterval(clientesNuevosVigilar, 45000); setTimeout(clientesNuevosVigilar, 8000);

// =====================================================================
// v54 · CHAT MUNDIAL (salas, solo clientes escriben, moderación automática)
// =====================================================================
(function chatMundial() {
  const SALAS = [["general", "💬 General"], ["duos", "🎮 Duos"], ["dudas", "❓ Dudas de recargas"]];
  const ERR = {
    REPETIDO: "Ese mensaje ya lo mandaste hace un momento 🙂",
    MUY_RAPIDO: "Esperá unos segundos entre mensajes ⏳", LINK: "No se permiten links ni redes en el chat 🚫",
    TELEFONO: "No se permiten teléfonos en el chat 🚫", PROMO: "No se puede hacer publicidad ni ofrecer recargas acá 🚫", VENTA: "No se permite vender ni ofrecer cosas en el chat 🚫",
    SILENCIADO: "Estás silenciado por un rato 🤫", TEXTO_INVALIDO: "Escribí un mensaje de hasta 200 letras.", NO_AUTENTICADO: "Ingresá con Google para escribir.",
  };
  let sala = "general", abierto = false, msgs = [], fijados = {}, puede = null, canal = null, timer = 0, ultimoId = 0, sinLeer = 0, enviando = false;
  const E = (id) => document.getElementById(id);
  const esAdm = () => { try { return esAdminActual(); } catch (_) { return false; } };

  async function calcPuede() {
    return (puede = !!usuarioActual);
  }
  async function cargar() {
    try {
      const { data, error } = await conTimeout(supabase.from("chat_global").select("*").eq("sala", sala).order("id", { ascending: false }).limit(60), 8000);
      if (error) throw error;
      msgs = (data || []).reverse();
      const ids = [...new Set(msgs.map((m) => m.user_id).filter(Boolean))].filter((u) => !(u in nivelesUsr)).slice(0, 200);
      if (ids.length) { try { const { data: n } = await conTimeout(supabase.rpc("niveles_de_usuarios", { p_ids: ids }), 6000); (n || []).forEach((r) => { nivelesUsr[r.user_id] = Number(r.diamantes) || 0; }); } catch (_) {} }
      try { await cargarPublicos(msgs.map((m) => m.user_id)); } catch (_) {}
      try { const { data: f } = await supabase.from("chat_fijado").select("*"); fijados = {}; (f || []).forEach((r) => { fijados[r.sala] = r.texto; }); } catch (_) {}
      const nuevo = msgs.length ? msgs[msgs.length - 1].id : 0;
      if (!abierto && ultimoId && nuevo > ultimoId) { sinLeer += msgs.filter((m) => m.id > ultimoId).length; pintarPunto(); }
      ultimoId = nuevo;
      if (abierto) pintar();
    } catch (_) { if (abierto) { const l = E("cm-lista"); if (l && !msgs.length) l.innerHTML = '<p class="cm-vacio">El chat se activa en un momento… 💎</p>'; } }
  }
  function pintarPunto() { const d = E("cm-dot"); if (d) { d.textContent = sinLeer > 9 ? "9+" : sinLeer; d.hidden = !sinLeer || abierto; } }
  function hora(t) { try { return new Date(t).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }); } catch (_) { return ""; } }
  function pintar() {
    const l = E("cm-lista"); if (!l) return;
    const abajo = l.scrollHeight - l.scrollTop - l.clientHeight < 80;
    l.innerHTML = "";
    if (!msgs.length) l.innerHTML = '<p class="cm-vacio">Todavía no hay mensajes. ¡Sé el primero en saludar! 👋</p>';
    msgs.forEach((m) => {
      const d = document.createElement("div");
      if (m.tipo === "sistema") {
        d.className = "cm-sis"; const b = document.createElement("b"); b.textContent = (perfPub[m.user_id] && perfPub[m.user_id].nombre) || m.nombre; d.appendChild(m.user_id ? conBanner(b, m.user_id, true) : b);
        d.appendChild(document.createTextNode(" " + m.texto));
      } else {
        const mio = usuarioActual && m.user_id === usuarioActual.id;
        d.className = "cm-msg" + (m.tipo === "admin" ? " cm-adm" : "") + (mio ? " cm-mio" : "") + (m.oculto ? " cm-oculto" : "");
        const cab = document.createElement("div"); cab.className = "cm-cab";
        const pp = perfPub[m.user_id];
        const n = document.createElement("b"); n.textContent = (pp && pp.nombre) || m.nombre;
        if (m.user_id) { n.className = "cm-nom-c"; n.title = "Ver perfil"; n.onclick = () => window.abrirPerfil && window.abrirPerfil(m.user_id); }
        const fotoM = m.tipo === "admin" ? (perfilSoporte && perfilSoporte.avatar_url) || (pp && pp.foto) : pp && pp.foto;
        const avM = miniAv(n.textContent, fotoM, "cm-av"); if (m.user_id) { avM.onclick = n.onclick; avM.style.cursor = "pointer"; } cab.appendChild(avM);
        cab.appendChild(m.tipo === "user" ? conBanner(n, m.user_id, true) : (m.tipo === "admin" ? conBanner(n, m.user_id, false) : n));
        if (m.tipo === "admin") { const s = document.createElement("span"); s.className = "cm-sello"; s.textContent = "✔ Oficial"; cab.appendChild(s); }
        d.appendChild(cab);
        const t = document.createElement("div"); t.className = "cm-txt"; t.textContent = m.texto;
        const h = document.createElement("small"); h.className = "cm-hora"; h.textContent = hora(m.created_at); t.appendChild(h);
        d.appendChild(t);
        if (m.oculto) { const o = document.createElement("em"); o.textContent = esAdm() ? "Oculto (" + (m.motivo || "") + ") — solo lo ves vos" : "Solo lo ves vos: lo revisamos"; d.appendChild(o); }
        mantenerPresionado(d, (x, y) => {
          const ops = [["📋", "Copiar", () => { try { navigator.clipboard.writeText(m.texto); mostrarAviso("Copiado", "exito"); } catch (_) {} }]];
          if (esAdm()) {
            ops.push(["📌", "Fijar arriba del chat", () => admAcc("chat_admin_fijar", { p_sala: "todas", p_texto: m.texto }, "Mensaje fijado")]);
            ops.push([m.oculto ? "👁" : "🙈", m.oculto ? "Mostrar" : "Ocultar", () => admAcc("chat_admin_ocultar", { p_id: m.id, p_ocultar: !m.oculto })]);
            if (m.user_id && !mio) ops.push(["🔇", "Silenciar 1 h", () => admAcc("chat_admin_silenciar", { p_user: m.user_id, p_min: 60 }, "Silenciado 1 hora")]);
            ops.push(["🗑", "Borrar", () => admAcc("chat_admin_borrar", { p_id: m.id }), true]);
          } else {
            ops.push(["↩️", "Responder", () => { const i = E("cm-in"); if (i) { i.value = "@" + ((pp && pp.nombre) || m.nombre) + " " + i.value; i.focus(); } }]);
            if (usuarioActual && !mio && m.tipo === "user") ops.push(["🚩", "Reportar", () => reportar(m.id, document.createElement("button")), true]);
          }
          menuHold(x, y, ops);
        });
      }
      l.appendChild(d);
    });
    const fj = fijados[sala], pf = E("cm-fijado");
    if (pf) { pf.hidden = !fj; if (fj) { pf.querySelector("span").textContent = fj; pf.querySelector("b").textContent = "Alma Zarela ✔ Oficial"; } }
    if (abajo || l.dataset.nuevo !== "1") { l.scrollTop = l.scrollHeight; l.dataset.nuevo = "1"; }
  }
  async function admAcc(fn, args, ok) {
    try { const { error } = await supabase.rpc(fn, args); if (error) throw error; if (ok) mostrarAviso(ok, "exito"); cargar(); }
    catch (_) { mostrarAviso("No se pudo (¿ejecutaste el SQL v39?)", "error"); }
  }
  async function reportar(id, b) {
    try { const { error } = await supabase.rpc("chat_reportar", { p_id: id }); if (error) throw error; b.textContent = "✔ Reportado"; b.disabled = true; mostrarAviso("Gracias, lo vamos a revisar 🙏", "exito"); }
    catch (_) { mostrarAviso("No se pudo reportar ahora", "error"); }
  }
  function pintarEntrada() {
    const f = E("cm-form"), av = E("cm-aviso"); if (!f || !av) return;
    f.hidden = !puede; av.hidden = !!puede;
    if (!puede) {
      av.innerHTML = "";
      if (!usuarioActual) { av.textContent = "Ingresá con Google para escribir. Por ahora podés leer 👀"; const b = document.createElement("button"); b.type = "button"; b.className = "cm-g"; b.textContent = "Enlazar con Google"; b.onclick = () => { cerrar(); window.loginConGoogle && window.loginConGoogle(); }; av.appendChild(b); }
      
    }
  }
  const esPC = () => matchMedia("(min-width: 801px)").matches && !document.body.classList.contains("modo-admin");
  let rafPC = 0;
  function posPC() { rafPC = 0; /* v58: la posición ahora es fija por CSS (ver fijarChat) */ }
  function marcarTabs(t) { document.querySelectorAll(".ch-tab").forEach((b) => b.classList.toggle("on", b.dataset.t === t)); }
  window.abrirChatMundo = () => {
    try { window.cerrarPanelesChat && window.cerrarPanelesChat(); } catch (_) {}
    try { if (typeof alternarChat === "function" && !esPC()) alternarChat(false); } catch (_) {}
    abrir(); if (esPC() && !rafPC) rafPC = requestAnimationFrame(posPC);
  };
  window.abrirChatSoporte = () => {
    cerrar();
    try { if (typeof alternarChat === "function" && !esPC()) alternarChat(true); } catch (_) {}
  };
  window.cerrarChatMundo = () => { if (abierto) cerrar(); };
  window.cmSinLeer = () => sinLeer;
  function pintarTabs() { marcarTabs(abierto ? "mundial" : "soporte"); }
  async function abrir() {
    const w = E("cm-panel"); if (!w) return;
    abierto = true; sinLeer = 0; pintarPunto(); w.classList.add("abierto"); document.body.classList.add("cm-abierto");
    pintarTabs(); pintarEntrada(); await calcPuede(); pintarEntrada(); await cargar();
    const bar = E("cm-mas"); if (bar) bar.hidden = !esAdm();
  }
  function cerrar() { abierto = false; const w = E("cm-panel"); if (w) { w.classList.remove("abierto"); w.style.cssText = ""; } document.body.classList.remove("cm-abierto"); marcarTabs("soporte"); }
  async function enviar() {
    if (enviando) return;
    const i = E("cm-in"), t = (i.value || "").trim(); if (!t) return;
    enviando = true; E("cm-env").disabled = true;
    try {
      const { data, error } = await supabase.rpc("chat_enviar", { p_sala: sala, p_texto: t });
      if (error) throw error;
      i.value = "";
      if (data && data.oculto) mostrarAviso("Tu mensaje quedó en revisión 🔎", "info");
      await cargar();
    } catch (e) {
      const m = String((e && e.message) || ""); const k = Object.keys(ERR).find((x) => m.includes(x));
      mostrarAviso(k ? ERR[k] : "No se pudo enviar. ¿Ejecutaste el SQL v39?", "error");
    }
    enviando = false; E("cm-env").disabled = false;
  }
  async function fijar() {
    const t = prompt("Texto fijado para TODAS las salas (vacío = quitar):", fijados[sala] || "");
    if (t === null) return;
    admAcc("chat_admin_fijar", { p_sala: "todas", p_texto: t }, t.trim() ? "Mensaje fijado" : "Quitado");
  }
  function iniciar() {
    E("cm-fab")?.addEventListener("click", () => (abierto ? cerrar() : abrir()));
    document.querySelectorAll(".ch-tab").forEach((b) => b.addEventListener("click", () => { const t = b.dataset.t; if (t === "mundial") window.abrirChatMundo(); else if (t === "soporte") window.abrirChatSoporte(); else if (window.abrirAmigos) window.abrirAmigos(""); }));
    marcarTabs("soporte");
    E("sb-mundo")?.addEventListener("click", () => { try { if ($("sidebar-menu")?.classList.contains("open")) toggleMenu(); } catch (_) {} setTimeout(() => window.abrirHub && window.abrirHub(), 200); });
    E("cm-x")?.addEventListener("click", () => window.abrirHub && window.abrirHub());
    E("cm-amg")?.addEventListener("click", () => window.abrirAmigos && window.abrirAmigos(""));
    E("cm-env")?.addEventListener("click", enviar);
    E("cm-in")?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); enviar(); } });
    E("cm-mas")?.addEventListener("click", (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); menuHold(r.right - 90, r.bottom, [["📌", "Fijar mensaje arriba del chat", fijar], ["🖼", "Fondo del chat", () => window.abrirSelectorFondo && window.abrirSelectorFondo()]]); });
    cargar();
    timer = setInterval(() => { if (!document.hidden) cargar(); }, abierto ? 4000 : 15000);
    setInterval(() => { if (!document.hidden && abierto) cargar(); }, 4000);
    try { canal = supabase.channel("chat-global").on("postgres_changes", { event: "*", schema: "public", table: "chat_global" }, () => cargar()).subscribe(); } catch (_) {}
  }
  supabase.auth.onAuthStateChange(() => { puede = null; setTimeout(async () => { await calcPuede(); pintarEntrada(); const b = E("cm-mas"); if (b) b.hidden = !esAdm(); }, 500); });
  document.addEventListener("DOMContentLoaded", iniciar);
})();

// =====================================================================
// v54 · Guía de primera visita: flecha para enlazar Google; al enlazar → tutorial original
// =====================================================================
(function guiaLogin() {
  const KG = "zarela_login_guia", KT = "zarela_tour_visto";
  const ls = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const lset = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
  let nodo = null;
  function quitar() { if (nodo) { nodo.remove(); nodo = null; } document.querySelectorAll(".lg-resalta").forEach((e) => e.classList.remove("lg-resalta")); }
  function mostrar() {
    if (nodo) return;
    const objetivo = (() => { const a = document.getElementById("auth-forms"); if (a && a.getClientRects().length) return a; return document.querySelector(".menu-toggle-btn"); })();
    nodo = document.createElement("div"); nodo.className = "lg-over";
    nodo.innerHTML = '<div class="lg-flecha">👇</div><div class="lg-card"><h3>¡Bienvenido a Zarela! 💎</h3><p>Primero enlazá tu cuenta de <b>Google</b>: es gratis, tarda 5 segundos y así guardás tu saldo, tus pedidos y tu nivel.</p><button type="button" class="lg-g">Enlazar con Google</button><button type="button" class="lg-no">Ahora no</button></div>';
    document.body.appendChild(nodo);
    if (objetivo) {
      objetivo.classList.add("lg-resalta");
      try { objetivo.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (_) {}
      const fl = nodo.querySelector(".lg-flecha");
      const pos = () => { if (!nodo) return; const r = objetivo.getBoundingClientRect(); fl.style.left = Math.max(8, Math.min(innerWidth - 50, r.left + r.width / 2 - 20)) + "px"; fl.style.top = Math.max(8, r.top - 52) + "px"; requestAnimationFrame(pos); };
      pos();
    }
    nodo.querySelector(".lg-g").onclick = () => { quitar(); try { window.loginConGoogle(); } catch (_) {} };
    nodo.querySelector(".lg-no").onclick = () => { quitar(); lset(KT, "1"); };
  }
  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
      if (usuarioActual || ls(KT) === "1" || ls(KG) === "1" || document.body.classList.contains("modo-admin") || location.hash.includes("access_token")) return;
      lset(KG, "1"); mostrar();
    }, 2800);
  });
  supabase.auth.onAuthStateChange((ev, session) => {
    if (!session) return;
    quitar();
    if (ev !== "SIGNED_IN") return;
    if (ls(KT) === "1" || (session.user.email || "").toLowerCase() === CONFIG.ADMIN_EMAIL.toLowerCase()) return;
    setTimeout(() => { if (ls(KT) !== "1" && window.abrirTutorial) window.abrirTutorial(); }, 1800);
  });
})();

// =====================================================================
// v55 · Interruptores, HISTORIAS, CUPONES / REFERIDOS / PUNTOS, panel Novedades
// =====================================================================
const NOV = (function novedades() {
  const E = (id) => document.getElementById(id);
  const adm = () => { try { return esAdminActual(); } catch (_) { return false; } };
  let cfg = {};
  const ERRN = {
    CODIGO_INVALIDO: "Ese código no existe o ya venció.", YA_USADO: "Esta cuenta ya usó un código. Es uno por cuenta.", SOLO_PRIMERA_RECARGA: "Los códigos valen solo para tu primera recarga.",
    CODIGO_PROPIO: "No podés usar tu propio código 😉", PROXIMAMENTE: "Esto todavía no está habilitado. ¡Pronto!", MINIMO: "Todavía no llegás al mínimo de puntos para canjear.",
    PUNTOS_INSUFICIENTES: "No tenés esa cantidad de puntos.", SOLO_CLIENTES: "Para subir historias tenés que haber hecho una recarga.", LIMITE: "Ya subiste 3 historias hoy. ¡Mañana más!",
    TEXTO_NO_PERMITIDO: "Ese texto no se puede publicar (sin links, teléfonos ni ofensas).", TEXTO_INVALIDO: "Escribí algo de hasta 80 letras.", NO_AUTENTICADO: "Ingresá con Google primero.",
  };
  const msgErr = (e, d) => { const m = String((e && e.message) || ""); const k = Object.keys(ERRN).find((x) => m.includes(x)); return k ? ERRN[k] : d; };
  async function cargarCfg() {
    try { const { data } = await conTimeout(supabase.from("novedades_config").select("*"), 8000); cfg = {}; (data || []).forEach((r) => { cfg[r.clave] = r.valor; }); } catch (_) {}
    return cfg;
  }
  const estado = (k) => {
    const v = cfg[k] || "off";
    if (v === "on") return "on";
    if (v === "pronto") { const h = cfg[k + "_hora"]; if (h && new Date(h).getTime() <= Date.now()) return "on"; return "pronto"; }
    return "off";
  };
  const activo = (k) => adm() || estado(k) === "on";
  const fechaHora = (k) => { const h = cfg[k + "_hora"]; if (!h) return ""; try { return new Date(h).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); } catch (_) { return ""; } };
  const num = (k, d) => { const n = Number(cfg[k]); return Number.isFinite(n) && cfg[k] !== undefined && cfg[k] !== "" ? n : d; };
  const fmt = (n) => Number(n).toLocaleString("es-AR", { maximumFractionDigits: 2 });
  const el = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt !== undefined) e.textContent = txt; return e; };
  const nubePronto = (k) => { const h = fechaHora(k); return estado(k) === "pronto" ? "Próximamente" + (h ? " · " + h : "") : ""; };

  // ------------------------------ HISTORIAS (pantalla completa, reacciones y mensajes) ------------------------------
  let hist = [], grupos = [], puedeSubir = null, amigosSet = new Set();
  const COLORES = 6, REACS = ["❤️", "🔥", "😂", "😮", "👏"];
  const urlImg = (p) => { try { return supabase.storage.from("historias").getPublicUrl(p).data.publicUrl; } catch (_) { return ""; } };
  const LS_V = "zarela_hs_vistas";
  let vistas = new Set(); try { vistas = new Set(JSON.parse(localStorage.getItem(LS_V) || "[]")); } catch (_) {}
  const visto = (id) => vistas.has(id);
  const marcarVisto = (id) => { if (vistas.has(id)) return; vistas.add(id); try { localStorage.setItem(LS_V, JSON.stringify([...vistas].slice(-500))); } catch (_) {} if (usuarioActual) supabase.rpc("historia_ver", { p_id: id }).then(() => {}, () => {}); };
  const miId = () => (usuarioActual ? usuarioActual.id : null);

  function avatarGrupo(g, cls) {
    const c = el("span", "hs-av " + (cls || ""));
    const ini = () => { c.textContent = g.oficial ? "💎" : (g.nombre || "?").trim().charAt(0).toUpperCase(); };
    const fo = g.oficial ? (perfilSoporte && perfilSoporte.avatar_url) : g.foto;
    if (fo && /^https:\/\//.test(fo)) { const im = el("img"); im.alt = ""; im.referrerPolicy = "no-referrer"; im.onerror = () => { im.remove(); ini(); }; im.src = fo; c.appendChild(im); } else ini();
    return c;
  }
  async function cargarHistorias() {
    try { const { data, error } = await conTimeout(supabase.rpc("historias_activas"), 8000); if (error) throw error; hist = data || []; } catch (_) { hist = []; }
    const mapa = new Map();
    hist.forEach((h) => { const k = h.oficial ? "oficial" : h.user_id; if (!mapa.has(k)) mapa.set(k, { k, oficial: !!h.oficial, nombre: h.nombre, foto: h.foto, user_id: h.user_id, items: [], ult: 0 }); const g = mapa.get(k); g.items.push(h); g.ult = Math.max(g.ult, new Date(h.created_at).getTime()); });
    grupos = [...mapa.values()].sort((a, b) => b.ult - a.ult);
    if (usuarioActual) { try { const { data } = await supabase.rpc("mis_amigos"); amigosSet = new Set((data || []).filter((x) => x.estado === "amigos").map((x) => x.id)); } catch (_) {} }
    pintarSlide(); if (!E("hs-panel").hidden) pintarPanel();
  }
  async function calcPuedeSubir() {
    if (!usuarioActual) return (puedeSubir = false);
    if (adm()) return (puedeSubir = true);
    try { const { data } = await conTimeout(supabase.rpc("he_recargado", { uid: usuarioActual.id }), 6000); puedeSubir = data === true; } catch (_) { puedeSubir = false; }
    return puedeSubir;
  }
  const sinVer = () => {
    const l = grupos.filter((g) => g.user_id !== miId() || g.oficial).map((g) => (g.oficial ? g : { ...g, items: g.items.filter((h) => !visto(h.id)) })).filter((g) => g.items.length);
    return [...l.filter((g) => g.oficial), ...l.filter((g) => !g.oficial)];   // Zarela siempre primero, anclada
  };
  const ofiTag = (cls) => el("em", cls, "Oficial");

  // ---- lámina del carrusel
  function pintarSlide() {
    const r = E("sh-in"); if (!r) return; r.innerHTML = "";
    const est = estado("f_historias");
    r.appendChild(el("h4", "sh-t", "✨ Historias"));
    if (est !== "on" && !adm()) {
      const c = el("div", "sh-pronto"); c.appendChild(el("div", "sh-pron-ic", "✨")); c.appendChild(el("b", "", est === "pronto" ? "Próximamente" + (fechaHora("f_historias") ? " · " + fechaHora("f_historias") : "") : "Próximamente"));
      c.appendChild(el("small", "", "Subí tu historia y mirá las de otros clientes."));
      r.appendChild(c); return;
    }
    const nuevas = sinVer(), total = nuevas.reduce((n, g) => n + g.items.length, 0);
    const nueva = el("button", "sh-b sh-nueva"); nueva.type = "button"; nueva.appendChild(el("span", "sh-c", "＋")); nueva.appendChild(el("small", "", "Tu historia")); nueva.onclick = abrirCreador;
    // PC: varias burbujas con la foto de cada cliente
    const pc = el("div", "sh-pc"); pc.appendChild(nueva.cloneNode(true)); pc.firstChild.onclick = abrirCreador;
    nuevas.slice(0, 6).forEach((g, i) => { const b = el("button", "sh-b" + (g.oficial ? " sh-ofi" : "")); b.type = "button"; const c = el("span", "sh-c"); c.appendChild(avatarGrupo(g)); b.appendChild(c); b.appendChild(el("small", "", g.oficial ? "Zarela" : g.nombre)); if (g.oficial) b.appendChild(ofiTag("sh-of")); b.onclick = () => abrirVisor(nuevas.slice(i)); pc.appendChild(b); });
    const todas = el("button", "sh-todas", "Ver todas ›"); todas.type = "button"; todas.onclick = abrirPanel; pc.appendChild(todas);
    if (!nuevas.length) pc.appendChild(el("span", "sh-vacio", "Ya viste todas las de hoy 🎉"));
    // celular: una sola burbuja que abre todo
    const mov = el("div", "sh-mov"); const uno = el("button", "sh-b sh-uno"); uno.type = "button"; const c1 = el("span", "sh-c sh-c-gr"); c1.appendChild(el("span", "sh-ic", "✨")); if (total) c1.appendChild(el("em", "sh-n", String(total))); uno.appendChild(c1);
    uno.appendChild(el("small", "", total ? "Ver historias" : "Sin novedades")); uno.onclick = abrirPanel; mov.appendChild(uno);
    const m2 = el("button", "sh-mini", "＋ Subir la tuya"); m2.type = "button"; m2.onclick = abrirCreador; mov.appendChild(m2);
    r.appendChild(pc); r.appendChild(mov);
  }

  // ---- panel completo con todas las historias de hoy
  function pintarPanel() {
    const g0 = E("hsp-grid"); g0.innerHTML = "";
    const mi = miId();
    const nb = el("button", "hsp-it hsp-nueva"); nb.type = "button"; const nc = el("span", "hsp-c", "＋"); nb.appendChild(nc); nb.appendChild(el("small", "", "Tu historia")); nb.onclick = () => { cerrarPanel(); abrirCreador(); }; g0.appendChild(nb);
    const orden = [...grupos].sort((a, b) => ((b.oficial ? 1 : 0) - (a.oficial ? 1 : 0)) || (visto(a.items[a.items.length - 1].id) - visto(b.items[b.items.length - 1].id)) || (b.ult - a.ult));
    orden.forEach((g) => {
      const todoVisto = g.items.every((h) => visto(h.id)), mia = mi && g.user_id === mi && !g.oficial;
      const b = el("button", "hsp-it" + (todoVisto ? " vista" : "") + (g.oficial ? " ofi" : "")); b.type = "button";
      const c = el("span", "hsp-c"); c.appendChild(avatarGrupo(g)); b.appendChild(c);
      b.appendChild(el("small", "", mia ? "Tu historia" : g.oficial ? "Zarela" : g.nombre + (amigosSet.has(g.user_id) ? " 🤝" : ""))); if (g.oficial) b.appendChild(ofiTag("hsp-of"));
      b.onclick = () => abrirVisor(orden.slice(orden.indexOf(g)), true);
      g0.appendChild(b);
    });
    if (!grupos.length) g0.appendChild(el("p", "hsp-vacio", "Todavía no hay historias hoy. ¡Subí la primera! ✨"));
  }
  function abrirPanel() { E("hs-panel").hidden = false; document.body.classList.add("hs-abierto"); pintarPanel(); }
  function cerrarPanel() { E("hs-panel").hidden = true; if (E("hs-visor").hidden) document.body.classList.remove("hs-abierto"); }

  // ---- visor a pantalla completa
  let cola = [], ci = 0, vt = 0, resumen = {}, desdePanel = false;
  function abrirVisor(grs, todo) {
    desdePanel = !!todo;
    cola = []; grs.forEach((g, gi) => g.items.forEach((h) => cola.push({ h, g, gi })));
    if (!cola.length) return;
    ci = 0; E("hs-visor").hidden = false; document.body.classList.add("hs-abierto"); mostrarHist();
  }
  function cerrarVisor() { clearTimeout(vt); E("hs-visor").hidden = true; if (E("hs-panel").hidden) document.body.classList.remove("hs-abierto"); cola = []; pintarSlide(); if (!E("hs-panel").hidden) pintarPanel(); }
  async function cargarResumen(ids) {
    try { const { data } = await supabase.rpc("historia_resumen", { p_ids: ids }); (data || []).forEach((r) => { (resumen[r.historia_id] = resumen[r.historia_id] || { n: {}, mia: null }); resumen[r.historia_id].n[r.emoji] = Number(r.n); if (r.mia) resumen[r.historia_id].mia = r.emoji; }); } catch (_) {}
  }
  function pintarReacs(h) {
    const c = E("hs-reacs"); c.innerHTML = ""; const rs = resumen[h.id] || { n: {}, mia: null };
    REACS.forEach((e) => { const b = el("button", "hs-re" + (rs.mia === e ? " on" : "")); b.type = "button"; b.appendChild(el("span", "", e)); if (rs.n[e]) b.appendChild(el("em", "", String(rs.n[e])));
      b.onclick = async () => {
        if (!usuarioActual) { mostrarAviso("Ingresá con Google para reaccionar.", "info"); return; }
        try { const { error } = await supabase.rpc("historia_reaccionar", { p_id: h.id, p_emoji: e }); if (error) throw error;
          const r = (resumen[h.id] = resumen[h.id] || { n: {}, mia: null }); if (r.mia) r.n[r.mia] = Math.max(0, (r.n[r.mia] || 1) - 1); r.n[e] = (r.n[e] || 0) + 1; r.mia = e; pintarReacs(h);
          const f = el("div", "hs-vuela", e); E("hs-cuerpo").appendChild(f); setTimeout(() => f.remove(), 1300);
        } catch (er) { mostrarAviso(msgErr(er, "No se pudo reaccionar."), "error"); }
      }; c.appendChild(b); });
  }
  async function mostrarHist() {
    clearTimeout(vt);
    if (ci >= cola.length) return cerrarVisor();
    if (ci < 0) ci = 0;
    const { h, g } = cola[ci], mi = miId(), mia = mi && h.user_id === mi && !h.oficial;
    marcarVisto(h.id);
    const del = E("hs-av"); del.innerHTML = ""; del.appendChild(avatarGrupo(g, "hs-av-s"));
    E("hs-nom").textContent = g.oficial ? "Alma Zarela ✔ Oficial" : g.nombre;
    try { E("hs-hora").textContent = new Date(h.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }); } catch (_) {}
    const mis = cola.filter((x) => x.g === g), pos = mis.findIndex((x) => x.h === h);
    const bar = E("hs-barras"); bar.innerHTML = ""; mis.forEach((_, k) => bar.appendChild(el("i", k < pos ? "ok" : k === pos ? "act" : "")));
    const c = E("hs-cuerpo"); c.innerHTML = ""; c.className = "hs-cuerpo c" + (h.color % COLORES);
    if (h.imagen_path) { const im = el("img"); im.alt = ""; im.src = urlImg(h.imagen_path); c.appendChild(im); }
    if (h.texto) c.appendChild(el("div", h.imagen_path ? "hs-pie" : "hs-gran", h.texto));
    E("hs-rep").hidden = !usuarioActual || mia || h.oficial; E("hs-rep").onclick = async () => { try { await supabase.rpc("historia_reportar", { p_id: h.id }); mostrarAviso("Gracias, lo vamos a revisar 🙏", "exito"); } catch (_) {} };
    E("hs-del").hidden = !adm(); E("hs-del").onclick = async () => { try { await supabase.rpc("admin_historia_borrar", { p_id: h.id }); mostrarAviso("Historia borrada", "exito"); cola.splice(ci, 1); await cargarHistorias(); mostrarHist(); } catch (_) { mostrarAviso("No se pudo borrar", "error"); } };
    E("hs-msg").value = "";
    E("hs-pie-bar").hidden = !!mia; E("hs-act").hidden = !mia;
    if (!mia) { pintarReacs(h); cargarResumen([h.id]).then(() => { if (cola[ci] && cola[ci].h === h) pintarReacs(h); }); }
    vt = setTimeout(() => { ci++; mostrarHist(); }, 6000);
  }
  async function enviarMsg() {
    const t = E("hs-msg").value.trim(); if (!t || !cola[ci]) return;
    if (!usuarioActual) { mostrarAviso("Ingresá con Google para escribir.", "info"); return; }
    const h = cola[ci].h, b = E("hs-env"); b.disabled = true;
    try { const { error } = await supabase.rpc("historia_mensaje", { p_id: h.id, p_texto: t }); if (error) throw error; E("hs-msg").value = ""; E("hs-msg").blur(); mostrarAviso("Mensaje enviado 💌", "exito"); }
    catch (e) { mostrarAviso(msgErr(e, "No se pudo enviar."), "error"); }
    b.disabled = false;
  }
  // actividad de mis historias
  async function abrirActividad() {
    clearTimeout(vt); E("ha-modal").hidden = false; const cu = E("ha-cuerpo"); cu.textContent = "Cargando…";
    try {
      const { data, error } = await supabase.rpc("mis_historias_actividad"); if (error) throw error; cu.innerHTML = "";
      if (!data.length) cu.appendChild(el("p", "adm-ayuda", "Todavía no subiste historias."));
      data.forEach((h) => {
        const f = el("div", "ha-it"); const top = el("div", "ha-top"); if (h.imagen_path) { const im = el("img"); im.src = urlImg(h.imagen_path); im.alt = ""; top.appendChild(im); } else top.appendChild(el("span", "ha-col c" + (h.color % 6)));
        const t = el("div", "ha-t"); t.appendChild(el("b", "", h.texto || "(foto)")); const pe = h.estado === "pendiente"; f.classList.add(pe ? "st-rev" : "st-act"); const sm = el("small", "", "👁 " + h.vistas + " vieron · "); sm.appendChild(el("em", pe ? "est-rev" : "est-act", pe ? "en revisión" : "activa")); t.appendChild(sm); top.appendChild(t); f.appendChild(top);
        if ((h.vistos || []).length) { const vv = el("div", "ha-re"); h.vistos.forEach((x) => { const sp = el("span", x.oficial ? "ha-of" : "", x.nombre + (x.oficial ? " ✔ Oficial" : "")); vv.appendChild(sp); }); f.appendChild(vv); }
        if (h.reacciones.length) { const r = el("div", "ha-re"); h.reacciones.forEach((x) => r.appendChild(el("span", "", x.emoji + " " + x.nombre))); f.appendChild(r); }
        h.mensajes.forEach((m) => { const d = el("div", "ha-msg"); d.appendChild(el("b", "", m.nombre + ": ")); d.appendChild(document.createTextNode(m.texto)); f.appendChild(d); });
        if (!h.reacciones.length && !h.mensajes.length) f.appendChild(el("small", "ha-nada", "Todavía sin reacciones ni mensajes."));
        cu.appendChild(f);
      });
    } catch (_) { cu.textContent = "No se pudo cargar (¿SQL v41?)."; }
  }
  // creador
  let fotoBlob = null, colorSel = 0;
  function abrirCreador() {
    if (!usuarioActual) { mostrarAviso("Ingresá con Google para subir historias.", "info"); try { window.loginConGoogle(); } catch (_) {} return; }
    if (puedeSubir === false) { mostrarAviso("Las historias son para clientes que ya hicieron una recarga 💎", "info"); return; }
    if (estado("f_historias") !== "on" && !adm()) { mostrarAviso("Las historias abren pronto ✨", "info"); return; }
    cerrarPanel();
    fotoBlob = null; colorSel = Math.floor(Math.random() * COLORES); E("hc-txt").value = ""; E("hc-quitar").hidden = true; E("hc-modal").hidden = false; pintarPrevHist();
    const cs = E("hc-colores"); cs.innerHTML = ""; for (let k = 0; k < COLORES; k++) { const b = el("button", "c" + k + (k === colorSel ? " on" : "")); b.type = "button"; b.onclick = () => { colorSel = k; [...cs.children].forEach((x, i) => x.classList.toggle("on", i === k)); pintarPrevHist(); }; cs.appendChild(b); }
  }
  function pintarPrevHist() {
    const p = E("hc-prev"); p.className = "hc-prev c" + colorSel; p.style.backgroundImage = fotoBlob ? "url(" + URL.createObjectURL(fotoBlob) + ")" : "";
    p.classList.toggle("conimg", !!fotoBlob); E("hc-prev-t").textContent = E("hc-txt").value || "Escribí algo…";
  }
  function comprimir(file) {
    return new Promise((res, rej) => {
      const im = new Image(), u = URL.createObjectURL(file);
      im.onload = () => { const M = 900, k = Math.min(1, M / Math.max(im.width, im.height)); const cv = document.createElement("canvas"); cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k); cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height); cv.toBlob((b) => (b ? res(b) : rej()), "image/jpeg", 0.78); URL.revokeObjectURL(u); };
      im.onerror = rej; im.src = u;
    });
  }
  async function publicarHist() {
    const btn = E("hc-pub"), t = E("hc-txt").value.trim();
    if (!fotoBlob && t.length < 2) { mostrarAviso("Escribí algo o agregá una foto.", "info"); return; }
    btn.disabled = true; btn.textContent = "Publicando…";
    try {
      let path = null;
      if (fotoBlob) { path = usuarioActual.id + "/" + Date.now() + ".jpg"; const { error } = await supabase.storage.from("historias").upload(path, fotoBlob, { contentType: "image/jpeg", upsert: false }); if (error) throw error; }
      const { data, error } = await supabase.rpc("historia_publicar", { p_texto: t, p_path: path, p_color: colorSel });
      if (error) throw error;
      E("hc-modal").hidden = true;
      mostrarAviso(data && data.estado === "pendiente" ? "¡Listo! Tu foto queda en revisión y sale en cuanto Zarela la apruebe 🔎" : "¡Historia publicada! ✨", "exito");
      cargarHistorias();
    } catch (e) { mostrarAviso(msgErr(e, "No se pudo publicar. ¿Ejecutaste el SQL v40?"), "error"); }
    btn.disabled = false; btn.textContent = "Publicar historia";
  }

  // ------------------------------ AMIGOS ------------------------------
  async function abrirAmigos(q) {
    if (!usuarioActual) { mostrarAviso("Ingresá con Google para agregar amigos.", "info"); try { window.loginConGoogle(); } catch (_) {} return; }
    E("am-modal").hidden = false; const inp = E("am-q"); inp.value = q || "";
    try { const { data } = await supabase.rpc("mi_num_id"); E("am-miid").textContent = data ? "#" + data : ""; } catch (_) {}
    pintarAmigos(); if (q) buscarAmigos();
  }
  async function pintarAmigos() {
    const l = E("am-lista"); l.innerHTML = "";
    try {
      const { data, error } = await supabase.rpc("mis_amigos"); if (error) throw error;
      const sec = (tit, arr, fn) => { if (!arr.length) return; l.appendChild(el("h5", "", tit)); arr.forEach((a) => l.appendChild(fila(a, fn(a)))); };
      sec("Solicitudes recibidas", data.filter((x) => x.estado === "recibida"), (a) => [["✔", async () => { await supabase.rpc("amigo_responder", { p_user: a.id, p_ok: true }); pintarAmigos(); cargarHistorias(); }], ["✕", async () => { await supabase.rpc("amigo_responder", { p_user: a.id, p_ok: false }); pintarAmigos(); }]]);
      sec("Mis amigos", data.filter((x) => x.estado === "amigos"), (a) => [["Quitar", async () => { if (confirm("¿Quitar a " + a.nombre + "?")) { await supabase.rpc("amigo_quitar", { p_user: a.id }); pintarAmigos(); cargarHistorias(); } }]]);
      sec("Enviadas (esperando)", data.filter((x) => x.estado === "enviada"), (a) => [["Cancelar", async () => { await supabase.rpc("amigo_quitar", { p_user: a.id }); pintarAmigos(); }]]);
      if (!data.length) l.appendChild(el("p", "adm-ayuda", "Todavía no tenés amigos. Buscá por nombre o por ID."));
    } catch (_) { l.appendChild(el("p", "adm-ayuda", "No se pudo cargar (¿ejecutaste el SQL v41?).")); }
  }
  function fila(a, acciones) {
    const f = el("div", "am-fila"); const av = avatarGrupo({ nombre: a.nombre, foto: a.foto }, "am-av"); av.style.cursor = "pointer"; av.title = "Ver perfil"; av.onclick = () => window.abrirPerfil && window.abrirPerfil(a.id); f.appendChild(av);
    const t = el("div", "am-t"); t.appendChild(el("b", "", a.nombre)); t.appendChild(el("small", "", "#" + a.num_id)); f.appendChild(t);
    (acciones || []).forEach(([txt, fn]) => { const b = el("button", "pr-mini", txt); b.type = "button"; b.onclick = fn; f.appendChild(b); }); return f;
  }
  async function buscarAmigos() {
    const q = E("am-q").value.trim(), r = E("am-res"); r.innerHTML = "";
    if (q.length < 2 && !/^#?\d+$/.test(q)) { r.appendChild(el("p", "adm-ayuda", "Escribí al menos 2 letras o el ID (ej: #25).")); return; }
    try {
      const { data, error } = await supabase.rpc("amigo_buscar", { p_q: q }); if (error) throw error;
      if (!data.length) r.appendChild(el("p", "adm-ayuda", "No encontré a nadie con ese nombre o ID."));
      data.forEach((a) => { const txt = { ninguna: "Agregar", enviada: "Enviada ✔", amigos: "Ya son amigos", recibida: "Aceptar" }[a.relacion]; r.appendChild(fila(a, [[txt, async () => { if (a.relacion === "ninguna" || a.relacion === "recibida") { try { await supabase.rpc("amigo_pedir", { p_user: a.id }); mostrarAviso(a.relacion === "ninguna" ? "Solicitud enviada 🤝" : "¡Ahora son amigos!", "exito"); buscarAmigos(); pintarAmigos(); } catch (_) { mostrarAviso("No se pudo", "error"); } } }]])); });
    } catch (_) { r.appendChild(el("p", "adm-ayuda", "No se pudo buscar (¿SQL v41?).")); }
  }
  window.abrirAmigos = abrirAmigos;

  // ------------------------------ CUPONES / REFERIDOS / PUNTOS ------------------------------
  async function abrirPremios() {
    if (!usuarioActual) { mostrarAviso("Ingresá con Google para usar cupones y puntos.", "info"); try { window.loginConGoogle(); } catch (_) {} return; }
    E("pr-modal").hidden = false; E("pr-cuerpo").textContent = "Cargando…";
    await cargarCfg();
    let canje = null, pts = 0, cod = "";
    try { const { data } = await supabase.from("canjes").select("*").maybeSingle(); canje = data; } catch (_) {}
    try { const { data } = await supabase.from("puntos").select("saldo").maybeSingle(); pts = data ? data.saldo : 0; } catch (_) {}
    try { if (activo("f_referidos")) { const { data } = await supabase.rpc("mi_codigo_referido"); cod = data || ""; } } catch (_) {}
    const cu = E("pr-cuerpo"); cu.innerHTML = "";
    const sec = (ico, tit, k) => { const d = el("div", "pr-sec"); const h = el("div", "pr-h"); h.appendChild(el("span", "", ico + " " + tit)); const n = nubePronto(k); if (n && !adm()) h.appendChild(el("em", "av-prox", n)); d.appendChild(h); cu.appendChild(d); return d; };
    // código
    const s1 = sec("🎟️", "Tengo un código", "f_cupones");
    s1.appendChild(el("p", "", "Un código por cuenta, válido para tu primera recarga. El regalo se suma a tu saldo cuando la recarga se acredita."));
    if (canje) s1.appendChild(el("div", "pr-ok", canje.estado === "aplicado" ? "✅ Ya aplicaste el código " + canje.codigo + (canje.bono ? " · +" + (canje.moneda === "ARS" ? "$" : "US$") + fmt(canje.bono) : "") : canje.estado === "anulado" ? "Tu código ya no se puede usar." : "✔ Código " + canje.codigo + " guardado. Se aplica en tu primera recarga."));
    else if (activo("f_cupones") || activo("f_referidos")) {
      const f = el("div", "pr-fila"); const i = el("input"); i.placeholder = "Ej: ZARELA10"; i.maxLength = 20; i.autocapitalize = "characters"; const b = el("button", "al-ok", "Canjear"); b.type = "button";
      b.onclick = async () => { b.disabled = true; try { const { error } = await supabase.rpc("codigo_canjear", { p_codigo: i.value }); if (error) throw error; mostrarAviso("¡Código guardado! 🎉 Se aplica en tu primera recarga.", "exito"); abrirPremios(); } catch (e) { mostrarAviso(msgErr(e, "No se pudo canjear."), "error"); } b.disabled = false; };
      f.appendChild(i); f.appendChild(b); s1.appendChild(f);
    }
    // referidos
    const s2 = sec("🤝", "Invitá a tus amigos", "f_referidos");
    const rp = num("ref_puntos", 50);
    s2.appendChild(el("p", "", "Tu amigo usa tu código en su primera recarga y recibe un bono. Cuando se acredita, vos ganás " + fmt(rp) + " puntos."));
    if (activo("f_referidos") && cod) {
      const f = el("div", "pr-cod"); f.appendChild(el("b", "", cod));
      const c = el("button", "pr-mini", "Copiar"); c.type = "button"; c.onclick = () => { try { navigator.clipboard.writeText(cod); mostrarAviso("Código copiado", "exito"); } catch (_) {} };
      const w = el("button", "pr-mini pr-wa", "WhatsApp"); w.type = "button"; w.onclick = () => window.open("https://wa.me/?text=" + encodeURIComponent("💎 Recargá Free Fire en https://almazarela.com y usá mi código " + cod + " en tu primera recarga para llevarte un bono 🎁"), "_blank", "noopener");
      f.appendChild(c); f.appendChild(w); s2.appendChild(f);
    }
    // puntos
    const s3 = sec("⭐", "Mis puntos", "f_puntos");
    const un = num("pts_unidad_ars", 1000), val = num("pts_valor_ars", 10), min = num("pts_min", 100);
    s3.appendChild(el("p", "", "Ganás 1 punto por cada $" + fmt(un) + " que recargás. Cada punto vale $" + fmt(val) + " de saldo (mínimo " + fmt(min) + " puntos)."));
    const big = el("div", "pr-pts"); big.appendChild(el("b", "", fmt(pts))); big.appendChild(el("span", "", "puntos · valen $" + fmt(pts * val))); s3.appendChild(big);
    const barra = el("div", "pr-barra"); const bi = el("i"); bi.style.width = Math.min(100, (pts / min) * 100) + "%"; barra.appendChild(bi); s3.appendChild(barra);
    if (activo("f_puntos")) {
      const b = el("button", "al-ok", pts >= min ? "Canjear " + fmt(pts) + " puntos por $" + fmt(pts * val) : "Te faltan " + fmt(Math.max(0, min - pts)) + " puntos"); b.type = "button"; b.disabled = pts < min;
      b.onclick = async () => { b.disabled = true; try { const { data, error } = await supabase.rpc("puntos_canjear", { p_puntos: pts }); if (error) throw error; mostrarAviso("¡Listo! Se sumaron $" + fmt(data.monto) + " a tu saldo en pesos 🎉", "exito"); abrirPremios(); try { window.cargarSaldo && window.cargarSaldo(); } catch (_) {} } catch (e) { mostrarAviso(msgErr(e, "No se pudo canjear."), "error"); b.disabled = false; } };
      s3.appendChild(b);
    }
  }

  // ------------------------------ PANEL ADMIN: NOVEDADES ------------------------------
  const FLAGS = [["f_historias", "✨ Historias"], ["f_cupones", "🎟️ Cupones"], ["f_referidos", "🤝 Referidos"], ["f_puntos", "⭐ Puntos"]];
  const AJUSTES = [["ref_amigo_pct", "Bono del amigo invitado (% de su 1ª recarga)"], ["ref_amigo_tope_ars", "…tope en pesos ($)"], ["ref_amigo_tope_usd", "…tope en dólares (US$)"], ["ref_puntos", "Puntos que gana quien invita"], ["pts_unidad_ars", "1 punto cada ($ pesos recargados)"], ["pts_unidad_usd", "1 punto cada (US$ recargados)"], ["pts_valor_ars", "Valor de 1 punto ($ pesos)"], ["pts_min", "Mínimo de puntos para canjear"]];
  const aLocal = (iso) => { if (!iso) return ""; const d = new Date(iso); if (isNaN(d)) return ""; const p = (n) => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" + p(d.getMinutes()); };
  async function rpcAdm(fn, args, ok) { try { const { error } = await supabase.rpc(fn, args); if (error) throw error; if (ok) mostrarAviso(ok, "exito"); return true; } catch (e) { mostrarAviso("No se pudo: " + ((e && e.message) || "revisá el SQL v40"), "error"); return false; } }
  const nvAbiertas = new Set(["fotos", "hist"]);
  const AYUDA = {
    fotos: { t: "📷 Fotos nuevas en chats privados", resumen: "Te avisa cuando tus clientes se mandan fotos entre amigos. Las fotos salen libres, vos solo las podés mirar.",
      que: "Los clientes que son amigos pueden mandarse fotos en su chat privado. No esperan tu aprobación, pero acá te aparece el aviso (y un número rojo en la pestaña Novedades).",
      donde: "Los clientes la ven en su chat privado, botón 📷 al lado de donde escriben.",
      pasos: ["Cuando alguien manda una foto, aparece un número rojo en «Novedades».", "Abrí este apartado: ves quiénes se escribieron.", "Tocá «Ver chat» para leer toda la conversación con las fotos.", "Si todo está bien, no hagas nada: el aviso se apaga solo al abrirla.", "Si algo está mal, buscá a la persona en «Chats privados» y silenciala 1 hora."],
      mock: '<div class="mk-chat"><div class="mk-b">Mirá mi skin 😎</div><div class="mk-img">📷 foto</div></div>' },
    hist: { t: "✨ Historias de clientes", resumen: "Las historias son fotos o frases que duran 24 horas. Acá elegís si salen libres o si las aprobás vos antes.",
      que: "Los clientes que ya recargaron suben una historia (foto o frase corta). Podés dejarlas LIBRES (salen enseguida) o CON APROBACIÓN (las fotos esperan tu OK; los textos siempre se filtran solos).",
      donde: "Los clientes las ven en el carrusel de arriba (la diapositiva «Historias») con círculos como en Instagram: tocan y se abre a pantalla completa.",
      pasos: ["Elegí abajo «Con aprobación» o «Libres» y tocá Guardar.", "Con aprobación: las fotos nuevas aparecen acá como «POR APROBAR».", "Tocá «Aprobar» (esa persona pasa a ser de confianza) o «Rechazar».", "Con 4 reportes de clientes, una historia se oculta sola.", "Con «＋ Subir historia oficial» publicás vos una historia de Zarela."],
      mock: '<div class="mk-circ"><i>＋</i><i>💎</i><i>J</i><i>M</i></div><small>Círculos de historias en el carrusel</small>' },
    histmsg: { t: "💌 Mensajes de historias", resumen: "Los mensajes raros que le escriben a una historia esperan tu decisión.",
      que: "Cuando alguien le escribe un mensaje a la historia de otro, se filtra solo. Los mensajes sospechosos y los que le escriben a tus historias oficiales llegan acá.",
      donde: "El cliente escribe desde el visor de la historia (campo «Escribí un mensaje…»).", pasos: ["Abrí este apartado.", "Leé el mensaje.", "«Entregar» lo manda a la persona; «Descartar» lo borra."], mock: '<div class="mk-b">Escribí un mensaje… ➤</div>' },
    chats: { t: "💬 Chats privados entre amigos", resumen: "Los amigos se escriben entre sí. Acá revisás lo dudoso y podés leer cualquier conversación.",
      que: "Dos clientes que son amigos pueden chatear. El sistema bloquea links, teléfonos y ventas, y esconde insultos para que los revises vos.",
      donde: "En el botón verde «Chat» → lista «Mis amigos» → tocan un amigo.",
      pasos: ["«Por revisar»: mensajes dudosos o reportados. Tocá Aprobar o Rechazar.", "Buscá a una persona con la lupa 🔎, tocá «Ver sus chats» y después «Abrir chat». Las conversaciones con muchas fotos salen marcadas en rojo 🚨.", "«Fotos en los chats»: elegí si están apagadas, revisadas o libres (ahora: libres).", "Podés silenciar 1 hora a quien moleste."],
      mock: '<div class="mk-chat"><div class="mk-b">¿Jugamos el torneo? 🏆</div><div class="mk-b mk-m">Dale 🔥 ✓✓</div></div>' },
    interr: { t: "🎛️ Interruptores", resumen: "Prendés o apagás cada novedad para todos tus clientes.",
      que: "Hay 4 funciones: Historias, Cupones, Referidos y Puntos. Cada una puede estar 🟢 Activa (todos la usan), 🕓 Próximamente (los clientes ven la etiqueta pero no la pueden usar) o ⚫ Apagada (no se ve). Vos siempre las podés probar.",
      donde: "En el menú lateral (☰): «Cupones y puntos» muestra la etiqueta «Próximamente» si está en ese estado. Historias aparece en el carrusel.",
      pasos: ["Elegí el estado en la lista de cada fila.", "Si ponés «Próximamente», podés elegir una fecha y hora: se activa SOLA a esa hora.", "Tocá «Guardar» en esa fila.", "Probá entrando como cliente: tiene que verse lo que elegiste."],
      mock: '<div class="mk-menu"><b>🎁 Cupones y puntos</b> <em>Próximamente</em></div>' },
    verif: { t: "✔ Insignia de verificación", resumen: "El tilde azul al lado del nombre. Vos decidís requisitos, precio y a quién se la das.",
      que: "Es un tilde azul que aparece junto al nombre del cliente en comentarios, chats y su perfil. Sirve para destacar clientes de confianza, y si querés, como extra pago.",
      donde: "Los clientes la piden desde su perfil (menú ☰ → «Mi perfil») en el botón «Pedir mi insignia». Si no cumplen las recargas mínimas, el botón está apagado.",
      pasos: ["Poné el Estado en «Activa».", "Elegí cuántas recargas mínimas pide, el precio (0 = gratis) y la duración (0 = de por vida).", "Los pedidos llegan a «📨 Pedidos»: tocá «Dar ✔» (si tiene precio, cobrá antes por el chat de soporte).", "También podés buscar a alguien por nombre o #ID y dársela directo.", "Para sacarla: «Quitar» en la lista de verificadas."],
      mock: '<div class="mk-b"><b>Juli JP</b> <span class="vf">✔</span></div>' },
    cup: { t: "🎟️ Cupones", resumen: "Códigos de regalo: un % de la primera recarga como saldo.",
      que: "Creás un código (ej. ZARELA10). El cliente lo canjea una vez y, cuando completa su primera recarga, recibe un % de esa recarga como saldo (con un tope para que no pierdas).",
      donde: "Menú ☰ → «Cupones y puntos» → «Tengo un código».",
      pasos: ["Escribí el CÓDIGO, el % (ej. 3), el tope en pesos y en dólares, y cuántos usos máximos.", "Opcional: una fecha de vencimiento.", "Tocá «Guardar cupón».", "En la lista podés Editar, Pausar o Borrar.", "Pasale el código a quien quieras (o ponelo en una promo)."],
      mock: '<div class="mk-menu"><b>🎟️ Tengo un código</b><br><span class="mk-in">ZARELA10</span> <em>Canjear</em></div>' },
    ajustes: { t: "⚙️ Ajustes de premios", resumen: "Los números de los premios: referidos y puntos. Mantenelos chicos.",
      que: "Define cuánto regalás. Referidos: un amigo usa el código de otro y recibe un % de su 1ª recarga; quien lo invitó gana puntos. Puntos: cada cliente suma 1 punto por cada $ que recarga y los canjea por saldo.",
      donde: "Menú ☰ → «Cupones y puntos»: ahí ven su código para invitar, sus puntos y el botón para canjear.",
      pasos: ["Ejemplo: bono 3 % con tope $1500 → si el amigo recarga $20.000 recibe $600.", "Ejemplo: 1 punto cada $1000 y cada punto vale $10 → recargar $50.000 da 50 puntos = $500.", "«Mínimo de puntos» = desde cuántos puntos pueden canjear.", "Cuidado con los márgenes: tu costo de 1.000 💎 es $11.616.", "Tocá «Guardar ajustes». Los premios se pagan solo cuando la recarga queda COMPLETADA."],
      mock: '<div class="mk-menu"><b>⭐ Mis puntos</b><br>50 puntos · valen $500</div>' },
    promos: { t: "📅 Promos programadas", resumen: "Mensajes que se publican SOLOS a una hora y en los días que elijas.",
      que: "Escribís un mensaje (ej. «¡50 % de descuento hoy!») y elegís a qué hora y qué días se publica solo, sin que estés conectada.",
      donde: "Si marcás «Chat», queda fijado arriba del chat Mundial con tu nombre. Si marcás «Historia», sale como historia oficial de Zarela por 24 horas.",
      pasos: ["Escribí el texto.", "Elegí la hora.", "Tildá los días (Lun, Mar, Mié, Jue, Vie, Sáb, Dom): solo salen los días con tilde ✔.", "Elegí dónde: Chat y/o Historia.", "Tocá «Agregar promo». En la lista podés «Publicar ahora», pausar o borrar."],
      mock: '<div class="mk-b">📌 <b>Alma Zarela ✔ Oficial</b><br>¡50 % de descuento hoy! 💎</div>' },
  };
  function abrirAyuda(id) {
    const a = AYUDA[id]; if (!a) return;
    let m = E("nv-ayuda"); if (!m) { m = el("div", "nh-modal nv-ayuda"); m.id = "nv-ayuda"; document.body.appendChild(m); m.addEventListener("click", (e) => { if (e.target === m) m.hidden = true; }); }
    m.innerHTML = ""; m.hidden = false;
    const c = el("div", "nv-ay-card"); const top = el("div", "nv-ay-top"); top.appendChild(el("b", "", a.t)); const x = el("button", "", "✕"); x.type = "button"; x.onclick = () => { m.hidden = true; }; top.appendChild(x); c.appendChild(top);
    const sec = (tit, txt) => { c.appendChild(el("h5", "", tit)); c.appendChild(el("p", "", txt)); };
    sec("¿Qué hace?", a.que); sec("¿Dónde lo ven los clientes?", a.donde);
    c.appendChild(el("h5", "", "Paso a paso")); const ol = el("ol"); a.pasos.forEach((p) => ol.appendChild(el("li", "", p))); c.appendChild(ol);
    if (a.mock) { c.appendChild(el("h5", "", "Así lo ven los clientes (ejemplo)")); const mk = el("div", "nv-mock"); mk.innerHTML = a.mock; c.appendChild(mk); }
    m.appendChild(c);
  }
  async function adminCargar() {
    const r = E("nv-admin"); if (!r) return;
    await cargarCfg();
    r.innerHTML = "";
    const idDe = (t) => t.includes("Interruptores") ? "interr" : t.includes("Ajustes") ? "ajustes" : t.includes("Cupones") ? "cup" : t.includes("Promos") ? "promos" : t.includes("Historias:") ? "hist" : t.includes("Mensajes de historias") ? "histmsg" : t.includes("Chats privados") ? "chats" : t.includes("Fotos nuevas") ? "fotos" : t.includes("Insignia") ? "verif" : t;
    const lista = [];
    const caja = (tit, ayuda) => {
      const id = idDe(tit), d = el("details", "nv-caja"); d.dataset.id = id; const sm = el("summary", "nv-sum"); sm.appendChild(el("span", "nv-st", tit));
      const bd = el("em", "nv-sbd"); bd.id = "nv-bd-" + id; bd.hidden = true; sm.appendChild(bd);
      const q = el("button", "nv-q", "?"); q.type = "button"; q.title = "¿Para qué sirve? Tocá y te explico"; q.setAttribute("aria-label", "Ayuda"); q.onclick = (e) => { e.preventDefault(); e.stopPropagation(); abrirAyuda(id); }; sm.appendChild(q); d.appendChild(sm);
      const body = el("div", "nv-cb"); if (AYUDA[id] && AYUDA[id].resumen) body.appendChild(el("p", "adm-ayuda", AYUDA[id].resumen)); else if (ayuda) body.appendChild(el("p", "adm-ayuda", ayuda)); d.appendChild(body);
      d.open = nvAbiertas.has(id); d.addEventListener("toggle", () => { if (d.open) nvAbiertas.add(id); else nvAbiertas.delete(id); });
      lista.push([id, d]); return body;
    };
    // interruptores
    const c1 = caja("🎛️ Interruptores", "Activo = lo ven todos. Próximamente = los clientes ven la etiqueta (y se activa solo a la hora que pongas). Apagado = lo oculta. Vos siempre podés probarlo.");
    FLAGS.forEach(([k, n]) => {
      const f = el("div", "nv-fila"); f.appendChild(el("b", "", n));
      const s = el("select"); [["on", "🟢 Activo"], ["pronto", "🕓 Próximamente"], ["off", "⚫ Apagado"]].forEach(([v, t]) => { const o = el("option", "", t); o.value = v; s.appendChild(o); }); s.value = cfg[k] || "pronto";
      const h = el("input"); h.type = "datetime-local"; h.value = aLocal(cfg[k + "_hora"]); h.title = "Se activa solo a esta hora (si está en Próximamente)";
      const b = el("button", "nv-btn", "Guardar"); b.type = "button";
      b.onclick = async () => { const ok1 = await rpcAdm("admin_nov_config", { p_clave: k, p_valor: s.value }); const ok2 = await rpcAdm("admin_nov_config", { p_clave: k + "_hora", p_valor: h.value ? new Date(h.value).toISOString() : "" }); if (ok1 && ok2) { mostrarAviso("Guardado ✔", "exito"); cargarCfg().then(pintarSlide); } };
      f.appendChild(s); f.appendChild(h); f.appendChild(b); c1.appendChild(f);
    });
    // ajustes
    const c2 = caja("⚙️ Ajustes de premios", "Los premios se acreditan solo cuando la recarga queda COMPLETADA. Mantenelos chicos: los márgenes son finos. (Referencia: costo 1.000 💎 = $11.616.)");
    const inputs = {};
    AJUSTES.forEach(([k, n]) => { const f = el("label", "nv-fila"); f.appendChild(el("span", "", n)); const i = el("input"); i.type = "number"; i.step = "any"; i.min = "0"; i.value = cfg[k] ?? ""; inputs[k] = i; f.appendChild(i); c2.appendChild(f); });
    const bg = el("button", "nv-btn nv-grande", "Guardar ajustes"); bg.type = "button"; bg.onclick = async () => { let ok = true; for (const [k] of AJUSTES) ok = (await rpcAdm("admin_nov_config", { p_clave: k, p_valor: String(inputs[k].value || "0") })) && ok; if (ok) mostrarAviso("Ajustes guardados ✔", "exito"); }; c2.appendChild(bg);
    // cupones
    const c3 = caja("🎟️ Cupones", "Un uso por cuenta y solo en la 1ª recarga. El regalo es un % de esa recarga con tope, y entra como saldo.");
    const lc = el("div", "nv-lista"); c3.appendChild(lc);
    const fc = el("div", "nv-form"); const q = (ph, w, t) => { const i = el("input"); i.placeholder = ph; if (t) i.type = t; if (w) i.style.maxWidth = w; return i; };
    const iCod = q("CÓDIGO", "110px"), iPct = q("% (ej 3)", "80px", "number"), iTa = q("tope $", "90px", "number"), iTu = q("tope US$", "90px", "number"), iUs = q("usos máx", "90px", "number"), iVe = q("vence", "150px", "date");
    iCod.maxLength = 20; iPct.value = 3; iTa.value = 1500; iTu.value = 1.5; iUs.value = 100;
    const bc = el("button", "nv-btn", "Guardar cupón"); bc.type = "button";
    bc.onclick = async () => { if (await rpcAdm("admin_cupon_guardar", { p_codigo: iCod.value, p_pct: Number(iPct.value), p_tope_ars: Number(iTa.value), p_tope_usd: Number(iTu.value), p_usos_max: Number(iUs.value), p_vence: iVe.value ? new Date(iVe.value + "T23:59:00").toISOString() : null, p_activo: true, p_nota: "" }, "Cupón guardado ✔")) { cargarCup(); } };
    [iCod, iPct, iTa, iTu, iUs, iVe, bc].forEach((x) => fc.appendChild(x)); c3.appendChild(fc);
    async function cargarCup() {
      lc.innerHTML = ""; try { const { data, error } = await supabase.rpc("admin_cupones_listar"); if (error) throw error; if (!data.length) lc.appendChild(el("p", "adm-ayuda", "Todavía no hay cupones.")); data.forEach((c) => {
        const f = el("div", "nv-item"); f.appendChild(el("b", "", c.codigo)); f.appendChild(el("span", "", c.pct + "% · tope $" + fmt(c.tope_ars) + " / US$" + fmt(c.tope_usd) + " · usos " + c.usos + "/" + c.usos_max + (c.vence ? " · vence " + new Date(c.vence).toLocaleDateString("es-AR") : "") + (c.activo ? "" : " · PAUSADO")));
        const e = el("button", "nv-mini", "Editar"); e.type = "button"; e.onclick = () => { iCod.value = c.codigo; iPct.value = c.pct; iTa.value = c.tope_ars; iTu.value = c.tope_usd; iUs.value = c.usos_max; iVe.value = c.vence ? c.vence.slice(0, 10) : ""; iCod.scrollIntoView({ block: "center" }); };
        const p = el("button", "nv-mini", c.activo ? "Pausar" : "Activar"); p.type = "button"; p.onclick = async () => { if (await rpcAdm("admin_cupon_guardar", { p_codigo: c.codigo, p_pct: c.pct, p_tope_ars: c.tope_ars, p_tope_usd: c.tope_usd, p_usos_max: c.usos_max, p_vence: c.vence, p_activo: !c.activo, p_nota: c.nota || "" })) cargarCup(); };
        const d = el("button", "nv-mini nv-rojo", "Borrar"); d.type = "button"; d.onclick = async () => { if (confirm("¿Borrar el cupón " + c.codigo + "?") && await rpcAdm("admin_cupon_borrar", { p_codigo: c.codigo })) cargarCup(); };
        f.appendChild(e); f.appendChild(p); f.appendChild(d); lc.appendChild(f); }); } catch (_) { lc.appendChild(el("p", "adm-ayuda", "No pude leer los cupones (¿ejecutaste el SQL v40?).")); }
    }
    cargarCup();
    // promos programadas
    const c4 = caja("📅 Promos programadas", "Se publican solas a la hora elegida: quedan fijadas arriba del chat mundial y/o salen como historia oficial de Zarela (24 h).");
    const lp = el("div", "nv-lista"); c4.appendChild(lp);
    const fp = el("div", "nv-pform");
    const paso = (n, t, nodo) => { const w = el("div", "nv-paso"); w.appendChild(el("span", "nv-pn", n)); const x = el("div", "nv-pc"); x.appendChild(el("b", "", t)); x.appendChild(nodo); w.appendChild(x); fp.appendChild(w); };
    const pT = el("input"); pT.placeholder = "Ej: ¡Hoy 50 % de descuento en diamantes! 💎"; pT.maxLength = 300; pT.style.width = "100%";
    const pH = el("input"); pH.type = "time"; pH.value = "18:00"; pH.style.maxWidth = "120px";
    const NOM = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
    const dias = el("div", "nv-dias"); const dchk = NOM.map((n, k) => { const l = el("label", "nv-d"); const c = el("input"); c.type = "checkbox"; c.checked = k < 5; l.appendChild(c); l.appendChild(el("span", "", n)); dias.appendChild(l); return c; });
    const dd = el("div", ""); dd.appendChild(dias); dd.appendChild(el("small", "adm-ayuda", "Solo sale en los días con tilde ✔."));
    const pC = el("label", "nv-d nv-dg"); const pCi = el("input"); pCi.type = "checkbox"; pCi.checked = true; pC.appendChild(pCi); pC.appendChild(el("span", "", "💬 Chat (fijado arriba del Mundial)"));
    const pS = el("label", "nv-d nv-dg"); const pSi = el("input"); pSi.type = "checkbox"; pSi.checked = true; pS.appendChild(pSi); pS.appendChild(el("span", "", "✨ Historia oficial (24 h)"));
    const dn = el("div", "nv-dias"); dn.appendChild(pC); dn.appendChild(pS);
    paso("1", "¿Qué dice el mensaje?", pT); paso("2", "¿A qué hora?", pH); paso("3", "¿Qué días?", dd); paso("4", "¿Dónde se publica?", dn);
    const bp = el("button", "nv-btn nv-grande", "Agregar promo"); bp.type = "button";
    bp.onclick = async () => { const d = []; dchk.forEach((c, k) => { if (c.checked) d.push(k + 1); }); if (!pT.value.trim() || !d.length) { mostrarAviso("Poné el texto y al menos un día.", "info"); return; } if (!pCi.checked && !pSi.checked) { mostrarAviso("Elegí dónde se publica: Chat o Historia.", "info"); return; } const { error } = await supabase.from("promos_prog").insert({ titulo: "", texto: pT.value.trim(), hora: pH.value || "18:00", dias: d, a_chat: pCi.checked, a_historia: pSi.checked, activo: true }); if (error) { mostrarAviso("No se pudo guardar la promo.", "error"); return; } pT.value = ""; mostrarAviso("Promo agregada ✔", "exito"); cargarPro(); };
    fp.appendChild(bp); c4.appendChild(fp);
    async function cargarPro() {
      lp.innerHTML = ""; try { const { data, error } = await supabase.from("promos_prog").select("*").order("id"); if (error) throw error; if (!data.length) lp.appendChild(el("p", "adm-ayuda", "No hay promos programadas.")); data.forEach((p) => {
        const f = el("div", "nv-item"); f.appendChild(el("b", "", (p.hora || "").slice(0, 5) + " · " + p.dias.map((d) => NOM[d - 1]).join(" ")));
        f.appendChild(el("span", "", p.texto + (p.a_chat ? " · 💬" : "") + (p.a_historia ? " · ✨" : "") + (p.activo ? "" : " · PAUSADA")));
        const a = el("button", "nv-mini", "Publicar ahora"); a.type = "button"; a.onclick = async () => { if (await rpcAdm("admin_promo_publicar_ahora", { p_id: p.id }, "Publicada ✔")) { cargarHistorias(); } };
        const z = el("button", "nv-mini", p.activo ? "Pausar" : "Activar"); z.type = "button"; z.onclick = async () => { await supabase.from("promos_prog").update({ activo: !p.activo }).eq("id", p.id); cargarPro(); };
        const d = el("button", "nv-mini nv-rojo", "Borrar"); d.type = "button"; d.onclick = async () => { if (confirm("¿Borrar esta promo?")) { await supabase.from("promos_prog").delete().eq("id", p.id); cargarPro(); } };
        [a, z, d].forEach((x) => f.appendChild(x)); lp.appendChild(f); }); } catch (_) { lp.appendChild(el("p", "adm-ayuda", "No pude leer las promos (¿ejecutaste el SQL v40?).")); }
    }
    cargarPro();
    // historias
    const c5 = caja("✨ Historias: para aprobar y activas", "Al aprobar una foto, esa persona pasa a ser «de confianza»: sus próximas fotos salen sin esperar (el texto siempre se filtra solo). Con 4 reportes una historia se oculta sola.");
    const fmh = el("div", "nv-fila"); fmh.appendChild(el("b", "", "📸 Las fotos de los clientes salen…"));
    const sh = el("select"); [["confianza", "🤝 Confianza: reviso la 1ª foto de cada cliente (recomendado)"], ["aprobacion", "🔎 Estricto: reviso todas las fotos"], ["libre", "🟢 Libre: todo sale enseguida"]].forEach(([v, t]) => { const o = el("option", "", t); o.value = v; sh.appendChild(o); }); sh.value = cfg.hist_modo || "confianza";
    const bh = el("button", "nv-btn", "Guardar"); bh.type = "button"; bh.onclick = async () => { if (await rpcAdm("admin_nov_config", { p_clave: "hist_modo", p_valor: sh.value }, "Guardado ✔")) cfg.hist_modo = sh.value; };
    fmh.appendChild(sh); fmh.appendChild(bh); c5.appendChild(fmh);
    const lh = el("div", "nv-lista nv-hgrid"); c5.appendChild(lh);
    async function cargarHis() {
      lh.innerHTML = ""; try {
        const { data, error } = await supabase.from("historias").select("*").or("estado.eq.pendiente,and(estado.eq.aprobada,expira_at.gt." + new Date().toISOString() + ")").order("created_at", { ascending: false }).limit(60); if (error) throw error;
        const pend = data.filter((h) => h.estado === "pendiente"); const bd = E("nv-pend-n"); if (bd) { bd.textContent = pend.length; bd.hidden = !pend.length; }
        const bd2 = E("nv-bd-hist"); if (bd2) { bd2.textContent = pend.length + " por aprobar"; bd2.hidden = !pend.length; }
        if (!data.length) lh.appendChild(el("p", "adm-ayuda", "No hay historias por ahora."));
        data.forEach((h) => { const pe = h.estado === "pendiente"; const f = el("div", "nv-item nv-his " + (pe ? "st-rev" : "st-act"));
          if (h.imagen_path) { const im = el("img"); im.src = urlImg(h.imagen_path); im.alt = "Ver foto grande"; im.title = "Tocá para verla grande"; im.onclick = () => { verFotoAdmin(urlImg(h.imagen_path), h); }; f.appendChild(im); }
          const t = el("div", "nv-his-t"); const bt = el("b", "", h.nombre); t.appendChild(bt);
          t.appendChild(el("em", pe ? "est-rev" : "est-act", pe ? "⏳ Por aprobar" : h.oculto ? "🚩 Oculta (reportes)" : "🟢 Activa")); t.appendChild(el("span", "", h.texto || "(solo foto)")); f.appendChild(t);
          const ac = el("div", "nv-his-ac");
          if (pe) { const ok = el("button", "nv-mini nv-verde", "Aprobar"); ok.type = "button"; ok.onclick = async () => { if (await rpcAdm("admin_historia_decidir", { p_id: h.id, p_aprobar: true, p_confiar: true }, "Aprobada ✔")) { cargarHis(); cargarHistorias(); } }; const no = el("button", "nv-mini nv-rojo", "Rechazar"); no.type = "button"; no.onclick = async () => { if (await rpcAdm("admin_historia_decidir", { p_id: h.id, p_aprobar: false, p_confiar: false })) cargarHis(); }; ac.appendChild(ok); ac.appendChild(no); }
          const d = el("button", "nv-mini nv-rojo", "Borrar"); d.type = "button"; d.onclick = async () => { if (confirm("¿Borrar esta historia?") && await rpcAdm("admin_historia_borrar", { p_id: h.id })) { cargarHis(); cargarHistorias(); } }; ac.appendChild(d); f.appendChild(ac); lh.appendChild(f); });
    function verFotoAdmin(url, h) {
      try { supabase.rpc("historia_ver", { p_id: h.id }).then(() => {}, () => {}); } catch (_) {}
      const v = el("div", "adm-zoom"); const im = el("img"); im.src = url; im.alt = ""; const x = el("button", "adm-zoom-x", "✕ Cerrar"); x.type = "button";
      const cerrar = () => { v.remove(); }; x.onclick = cerrar; v.onclick = (e) => { if (e.target === v) cerrar(); }; v.appendChild(im); v.appendChild(x); document.body.appendChild(v);
    }
      } catch (_) { lh.appendChild(el("p", "adm-ayuda", "No pude leer las historias (¿ejecutaste el SQL v40?).")); }
    }
    cargarHis();
    const c6 = caja("💌 Mensajes de historias a revisar", "Acá llegan los mensajes raros (no se entregan hasta que vos digas) y los que le escriben a tus historias oficiales.");
    const lm = el("div", "nv-lista"); c6.appendChild(lm);
    async function cargarMsgs() {
      lm.innerHTML = ""; try { const { data, error } = await supabase.rpc("admin_historias_mensajes"); if (error) throw error; if (!data.length) lm.appendChild(el("p", "adm-ayuda", "Sin mensajes por revisar."));
        data.forEach((m) => { const f = el("div", "nv-item"); f.appendChild(el("b", "", m.de + (m.estado === "revision" ? " · ⚠ DUDOSO" : " · a tu historia"))); f.appendChild(el("span", "", "«" + m.texto + "»" + (m.historia ? "  ↪ " + m.historia : "")));
          if (m.estado === "revision") { const ok = el("button", "nv-mini nv-verde", "Entregar"); ok.type = "button"; ok.onclick = async () => { if (await rpcAdm("admin_historia_msg_decidir", { p_id: m.id, p_entregar: true })) cargarMsgs(); }; const no = el("button", "nv-mini nv-rojo", "Descartar"); no.type = "button"; no.onclick = async () => { if (await rpcAdm("admin_historia_msg_decidir", { p_id: m.id, p_entregar: false })) cargarMsgs(); }; f.appendChild(ok); f.appendChild(no); }
          lm.appendChild(f); }); } catch (_) { lm.appendChild(el("p", "adm-ayuda", "No pude leer (¿ejecutaste el SQL v41?).")); }
    }
    cargarMsgs();
    const c7 = caja("💬 Chats privados entre amigos", "Los amigos pueden escribirse entre ellos (con filtros). Elegí qué pasa con las fotos. Los mensajes dudosos y reportados te llegan acá para aprobar o descartar.");
    const fm = el("div", "nv-fila"); fm.appendChild(el("b", "", "📷 Fotos en los chats"));
    const sf = el("select"); [["off", "⚫ Apagadas (nadie manda fotos)"], ["primeras", "🔎 Las primeras 3 de cada persona las revisás vos"], ["on", "🟢 Libres"]].forEach(([v, t]) => { const o = el("option", "", t); o.value = v; sf.appendChild(o); }); sf.value = cfg.dm_fotos || "off";
    const bf = el("button", "nv-btn", "Guardar"); bf.type = "button"; bf.onclick = async () => { if (await rpcAdm("admin_nov_config", { p_clave: "dm_fotos", p_valor: sf.value }, "Guardado ✔")) cfg.dm_fotos = sf.value; };
    fm.appendChild(sf); fm.appendChild(bf); c7.appendChild(fm);
    c7.appendChild(el("h5", "nv-sub", "⚠ Por revisar"));
    const lq = el("div", "nv-lista"); c7.appendChild(lq);
    const fotoU = (p) => { try { return supabase.storage.from("chatfotos").getPublicUrl(p).data.publicUrl; } catch (_) { return ""; } };
    async function cargarCola() {
      lq.innerHTML = ""; try { const { data, error } = await supabase.rpc("admin_dm_cola"); if (error) throw error; if (!data.length) lq.appendChild(el("p", "adm-ayuda", "Nada para revisar 🎉"));
        data.forEach((m) => { const f = el("div", "nv-item nv-his"); if (m.foto) { const im = el("img"); im.src = fotoU(m.foto); im.alt = ""; f.appendChild(im); }
          const t = el("div", "nv-his-t"); t.appendChild(el("b", "", m.de + " → " + m.para + (m.reportado ? " · 🚩 REPORTADO" : " · ⚠ DUDOSO"))); t.appendChild(el("span", "", m.tipo === "foto" ? "📷 foto" + (m.texto ? ": " + m.texto : "") : "«" + m.texto + "»")); f.appendChild(t);
          const ok = el("button", "nv-mini nv-verde", "Aprobar"); ok.type = "button"; ok.onclick = async () => { if (await rpcAdm("admin_dm_decidir", { p_id: m.id, p_ok: true })) cargarCola(); };
          const no = el("button", "nv-mini nv-rojo", "Rechazar"); no.type = "button"; no.onclick = async () => { if (await rpcAdm("admin_dm_decidir", { p_id: m.id, p_ok: false })) cargarCola(); };
          const sl = el("button", "nv-mini", "Silenciar 1 h"); sl.type = "button"; sl.onclick = () => rpcAdm("chat_admin_silenciar", { p_user: m.de_id, p_min: 60 }, "Silenciado 1 hora");
          f.appendChild(ok); f.appendChild(no); f.appendChild(sl); lq.appendChild(f); }); } catch (_) { lq.appendChild(el("p", "adm-ayuda", "No pude leer (¿ejecutaste el SQL v42?).")); }
    }
    cargarCola();
    c7.appendChild(el("h5", "nv-sub", "🔍 Buscar los chats de una persona"));
    const bq = el("div", "nv-busca"); const qi = el("input", "nv-in"); qi.type = "search"; qi.placeholder = "🔎 Nombre o número de cliente…"; const qb = el("button", "nv-btn", "Buscar"); qb.type = "button"; bq.appendChild(qi); bq.appendChild(qb); c7.appendChild(bq);
    const lpz = el("div", "nv-lista"); c7.appendChild(lpz);
    const RARO_F = 5, RARO_M = 150;
    function visorHilo(a, b, na, nb) {
      const v = el("div", "adm-zoom adm-hilo"); const c = el("div", "adm-hilo-c"); const cab = el("div", "adm-hilo-cab"); cab.appendChild(el("b", "", na + " ↔ " + nb)); const x = el("button", "adm-zoom-x", "✕ Cerrar"); x.type = "button"; cab.appendChild(x); c.appendChild(cab);
      const cu = el("div", "adm-hilo-cu"); cu.textContent = "Cargando…"; c.appendChild(cu); v.appendChild(c); document.body.appendChild(v); x.onclick = () => v.remove(); v.onclick = (e) => { if (e.target === v) v.remove(); };
      supabase.rpc("admin_dm_hilo", { p_a: a, p_b: b }).then(({ data: h, error }) => { if (error) throw error; cu.innerHTML = ""; if (!h.length) cu.textContent = "Sin mensajes.";
        h.forEach((m) => { const r = el("div", "nv-hm" + (m.estado !== "ok" ? " mal" : "")); r.appendChild(el("b", "", m.de + ": ")); if (m.tipo === "foto") { const im = el("img"); im.src = fotoU(m.foto); im.alt = ""; r.appendChild(im); } else r.appendChild(document.createTextNode(m.tipo === "id" ? "🎮 ID " + m.texto : m.texto)); cu.appendChild(r); }); cu.scrollTop = cu.scrollHeight; }).catch(() => { cu.textContent = "No se pudo leer."; });
    }
    async function buscarDm() {
      const q = qi.value.trim(); lpz.innerHTML = ""; if (q.length < 2 && !/^\d+$/.test(q)) { lpz.appendChild(el("p", "adm-ayuda", "Escribí al menos 2 letras o el número de cliente.")); return; }
      try { const { data, error } = await supabase.rpc("admin_dm_buscar", { p_q: q }); if (error) throw error; if (!data.length) lpz.appendChild(el("p", "adm-ayuda", "No encontré a nadie con ese dato."));
        data.forEach((p) => { const f = el("div", "nv-item nv-pers"); f.appendChild(el("b", "", p.nombre + (p.num_id ? " · #" + p.num_id : ""))); f.appendChild(el("span", "", p.mensajes + " mensajes"));
          const v = el("button", "nv-mini", "Ver sus chats"); v.type = "button"; v.onclick = () => verConQuien(p); f.appendChild(v); lpz.appendChild(f); });
      } catch (_) { lpz.appendChild(el("p", "adm-ayuda", "No pude buscar (¿ejecutaste el SQL v45?).")); }
    }
    async function verConQuien(p) {
      lpz.innerHTML = ""; const volver = el("button", "nv-mini", "← Volver a buscar"); volver.type = "button"; volver.onclick = buscarDm; lpz.appendChild(volver); lpz.appendChild(el("h5", "nv-sub", "Mensajes con: " + p.nombre));
      try { const { data, error } = await supabase.rpc("admin_dm_con", { p_user: p.id }); if (error) throw error; if (!data.length) lpz.appendChild(el("p", "adm-ayuda", "No chatea con nadie todavía."));
        data.forEach((o) => { const raro = o.fotos >= RARO_F || o.mensajes >= RARO_M || o.dudosos > 0; const f = el("div", "nv-item nv-pers" + (raro ? " raro" : "")); f.appendChild(el("b", "", o.otro));
          f.appendChild(el("span", "", o.mensajes + " mensajes · 📷 " + o.fotos + (o.dudosos ? " · ⚠ " + o.dudosos + " dudosos" : "") + " · último " + new Date(o.ult).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })));
          if (raro) f.appendChild(el("em", "est-raro", "🚨 Conversación rara: " + (o.fotos >= RARO_F ? "muchas fotos" : o.dudosos ? "mensajes dudosos" : "muchísimos mensajes")));
          const v = el("button", "nv-mini", "Abrir chat"); v.type = "button"; v.onclick = () => visorHilo(p.id, o.otro_id, p.nombre, o.otro); f.appendChild(v); lpz.appendChild(f); });
      } catch (_) { lpz.appendChild(el("p", "adm-ayuda", "No se pudo leer.")); }
    }
    qb.onclick = buscarDm; qi.addEventListener("keydown", (e) => { if (e.key === "Enter") buscarDm(); });

    // ---------- 📷 Fotos nuevas en chats privados ----------
    const cF = caja("📷 Fotos nuevas en chats privados", "Las fotos se envían libres (sin esperar tu OK). Acá te avisamos cuando hay nuevas: tocá «Ver chat» para mirar la conversación completa.");
    const lF = el("div", "nv-lista"); cF.appendChild(lF);
    const fotoU2 = (p) => { try { return supabase.storage.from("chatfotos").getPublicUrl(p).data.publicUrl; } catch (_) { return ""; } };
    async function cargarFotosN() {
      lF.innerHTML = ""; try { const { data, error } = await supabase.rpc("admin_dm_fotos_nuevas"); if (error) throw error; if (!data.length) lF.appendChild(el("p", "adm-ayuda", "No hay fotos nuevas 🎉"));
        data.forEach((p) => { const f = el("div", "nv-item"); f.appendChild(el("b", "", p.n1 + " ↔ " + p.n2)); f.appendChild(el("span", "", "📷 " + p.fotos + (p.fotos === 1 ? " foto nueva" : " fotos nuevas")));
          const v = el("button", "nv-mini nv-verde", "Ver chat"); v.type = "button"; const hilo = el("div", "nv-hilo"); hilo.hidden = true;
          v.onclick = async () => { if (!hilo.hidden) { hilo.hidden = true; return; } hilo.hidden = false; hilo.textContent = "Cargando…";
            try { const { data: h, error: e2 } = await supabase.rpc("admin_dm_hilo", { p_a: p.u1, p_b: p.u2 }); if (e2) throw e2; hilo.innerHTML = "";
              h.forEach((m) => { const r = el("div", "nv-hm"); r.appendChild(el("b", "", m.de + ": ")); if (m.tipo === "foto" && m.foto) { const im = el("img", "nv-foto"); im.src = fotoU2(m.foto); im.alt = "foto"; im.onclick = () => window.open(im.src, "_blank"); r.appendChild(im); } else r.appendChild(document.createTextNode(m.tipo === "id" ? "🎮 " + m.texto : (m.texto || ""))); hilo.appendChild(r); });
              await supabase.rpc("admin_dm_fotos_vistas", { p_a: p.u1, p_b: p.u2 }); pintarPuntoAdmin();
              const ok = el("button", "nv-mini", "Listo, ya la vi"); ok.type = "button"; ok.onclick = cargarFotosN; hilo.appendChild(ok);
            } catch (_) { hilo.textContent = "No pude leer el chat."; } };
          f.appendChild(v); f.appendChild(hilo); lF.appendChild(f); }); } catch (_) { lF.appendChild(el("p", "adm-ayuda", "No pude leer (¿ejecutaste el SQL v43?).")); }
    }
    cargarFotosN();

    // ---------- ✔ Verificación ----------
    const cV = caja("✔ Insignia de verificación", "Es el tilde que aparece junto al nombre del cliente (comentarios, chats, perfil). Sirve para destacar a clientes de confianza y, si querés, como un extra pago. Cómo funciona: 1) vos fijás los requisitos y el precio acá abajo; 2) el cliente toca «Pedir mi insignia» en su perfil (solo si cumple las recargas mínimas); 3) te llega el pedido a esta lista; 4) si hay precio, se coordina el pago por el chat de soporte y vos la activás con un toque. También podés dársela vos directo a quien quieras. Precio 0 = gratis. Duración 0 = de por vida.");
    const vF = el("div", "nv-fila"); vF.appendChild(el("b", "", "Estado"));
    const vs = el("select"); [["on", "🟢 Activa (los clientes pueden pedirla)"], ["pronto", "🕓 Próximamente"], ["off", "⚫ Apagada (no se ve nada)"]].forEach(([v, t]) => { const o = el("option", "", t); o.value = v; vs.appendChild(o); }); vs.value = cfg.f_verif || "off";
    const vb = el("button", "nv-btn", "Guardar"); vb.type = "button"; vb.onclick = async () => { if (await rpcAdm("admin_nov_config", { p_clave: "f_verif", p_valor: vs.value }, "Guardado ✔")) cfg.f_verif = vs.value; };
    vF.appendChild(vs); vF.appendChild(vb); cV.appendChild(vF);
    const VAJ = [["verif_min_recargas", "Recargas mínimas para poder pedirla"], ["verif_precio_ars", "Precio en pesos ($) · 0 = gratis"], ["verif_precio_usd", "Precio en dólares (US$) · 0 = gratis"], ["verif_dias", "Duración en días · 0 = de por vida"]];
    const vin = {}; VAJ.forEach(([k, n]) => { const f = el("label", "nv-fila"); f.appendChild(el("span", "", n)); const i = el("input"); i.type = "number"; i.step = "any"; i.min = "0"; i.value = cfg[k] ?? ""; vin[k] = i; f.appendChild(i); cV.appendChild(f); });
    const vg = el("button", "nv-btn nv-grande", "Guardar requisitos y precio"); vg.type = "button";
    vg.onclick = async () => { let ok = true; for (const [k] of VAJ) ok = (await rpcAdm("admin_nov_config", { p_clave: k, p_valor: String(vin[k].value || "0") })) && ok; if (ok) mostrarAviso("Guardado ✔", "exito"); };
    cV.appendChild(vg);
    cV.appendChild(el("h5", "nv-sub", "📨 Pedidos"));
    const lVp = el("div", "nv-lista"); cV.appendChild(lVp);
    cV.appendChild(el("h5", "nv-sub", "✔ Cuentas verificadas"));
    const lVa = el("div", "nv-lista"); cV.appendChild(lVa);
    cV.appendChild(el("h5", "nv-sub", "➕ Darle la insignia a alguien"));
    const fB = el("div", "nv-form"); const iB = el("input"); iB.placeholder = "Nombre o # de ID (ej: #25)"; iB.style.minWidth = "200px"; const bB = el("button", "nv-btn", "Buscar"); bB.type = "button"; fB.appendChild(iB); fB.appendChild(bB); cV.appendChild(fB);
    const lVb = el("div", "nv-lista"); cV.appendChild(lVb);
    const diasDef = () => Number(vin.verif_dias.value) || 0;
    async function cargarVerifAdm() {
      lVp.innerHTML = ""; lVa.innerHTML = "";
      try { const { data, error } = await supabase.rpc("admin_verif_listar"); if (error) throw error;
        if (!data.pedidos.length) lVp.appendChild(el("p", "adm-ayuda", "No hay pedidos nuevos."));
        data.pedidos.forEach((x) => { const f = el("div", "nv-item"); f.appendChild(el("b", "", x.nombre + " · #" + x.num_id)); f.appendChild(el("span", "", x.recargas + " recargas"));
          const ok = el("button", "nv-mini nv-verde", "Dar ✔"); ok.type = "button"; ok.onclick = async () => { if (await rpcAdm("admin_verif_dar", { p_user: x.id, p_dias: diasDef() }, "Insignia activada ✔")) cargarVerifAdm(); };
          const no = el("button", "nv-mini nv-rojo", "Descartar"); no.type = "button"; no.onclick = async () => { if (await rpcAdm("admin_verif_quitar", { p_user: x.id })) cargarVerifAdm(); };
          f.appendChild(ok); f.appendChild(no); lVp.appendChild(f); });
        if (!data.activos.length) lVa.appendChild(el("p", "adm-ayuda", "Todavía no hay cuentas verificadas."));
        data.activos.forEach((x) => { const f = el("div", "nv-item"); f.appendChild(el("b", "", "✔ " + x.nombre + " · #" + x.num_id)); f.appendChild(el("span", "", x.hasta ? "vence " + new Date(x.hasta).toLocaleDateString("es-AR") : "de por vida"));
          const q = el("button", "nv-mini nv-rojo", "Quitar"); q.type = "button"; q.onclick = async () => { if (confirm("¿Quitarle la insignia a " + x.nombre + "?") && await rpcAdm("admin_verif_quitar", { p_user: x.id })) cargarVerifAdm(); };
          f.appendChild(q); lVa.appendChild(f); });
      } catch (_) { lVp.appendChild(el("p", "adm-ayuda", "No pude leer (¿ejecutaste el SQL v43?).")); }
    }
    bB.onclick = async () => { lVb.innerHTML = ""; try { const { data, error } = await supabase.rpc("admin_verif_buscar", { p_q: iB.value }); if (error) throw error; if (!data.length) lVb.appendChild(el("p", "adm-ayuda", "No encontré a nadie."));
      data.forEach((x) => { const f = el("div", "nv-item"); f.appendChild(el("b", "", x.nombre + " · #" + x.num_id)); f.appendChild(el("span", "", x.recargas + " recargas" + (x.verificado ? " · ya tiene ✔" : "")));
        const ok = el("button", "nv-mini nv-verde", x.verificado ? "Renovar ✔" : "Dar ✔"); ok.type = "button"; ok.onclick = async () => { if (await rpcAdm("admin_verif_dar", { p_user: x.id, p_dias: diasDef() }, "Insignia activada ✔")) { cargarVerifAdm(); lVb.innerHTML = ""; } };
        f.appendChild(ok); lVb.appendChild(f); }); } catch (_) { lVb.appendChild(el("p", "adm-ayuda", "No pude buscar (¿SQL v43?).")); } };
    iB.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); bB.click(); } });
    cargarVerifAdm();
    const nuevoH = el("button", "nv-btn", "＋ Subir historia oficial"); nuevoH.type = "button"; nuevoH.onclick = abrirCreador; c5.appendChild(nuevoH);
    const ORDEN = ["fotos", "hist", "histmsg", "chats", "interr", "verif", "cup", "ajustes", "promos"];
    lista.sort((a, b) => ORDEN.indexOf(a[0]) - ORDEN.indexOf(b[0]));
    const guia = el("p", "nv-guia", "Ordenado de lo más importante a lo menos importante. Tocá el título para abrir o cerrar cada apartado, y el ❓ rojo para que te explique qué hace y cómo lo ven los clientes.");
    r.appendChild(guia); lista.forEach(([, d]) => r.appendChild(d));
  }
  window.novAdminCargar = adminCargar;
  // punto rojo con el número de fotos nuevas (pestaña Novedades y acceso en Pendientes)
  let fotosPrev = null;
  async function pintarPuntoAdmin() {
    if (!adm()) return;
    let n = 0; try { const { data } = await supabase.rpc("admin_dm_fotos_nuevas"); n = (data || []).reduce((a, x) => a + Number(x.fotos || 0), 0); } catch (_) { return; }
    document.querySelectorAll("#admin-tab-novedades, .hoy-nov").forEach((b) => { let p = b.querySelector(".nv-pt"); if (!n) { if (p) p.remove(); return; } if (!p) { p = el("em", "nv-pt"); b.appendChild(p); } p.textContent = n > 99 ? "99+" : String(n); p.title = n + " foto(s) nueva(s) en chats privados"; });
    if (fotosPrev !== null && n > fotosPrev) mostrarAviso("📷 Hay fotos nuevas en chats privados", "info");
    fotosPrev = n;
  }
  window.novPuntoAdmin = pintarPuntoAdmin;
  setInterval(() => { if (!document.hidden) pintarPuntoAdmin(); }, 60000);
  setTimeout(pintarPuntoAdmin, 5000);

  async function iniciar() {
    await cargarCfg(); await cargarHistorias(); calcPuedeSubir();
    E("hs-x")?.addEventListener("click", cerrarVisor);
    E("hs-sig")?.addEventListener("click", () => { ci++; mostrarHist(); });
    E("hs-ant")?.addEventListener("click", () => { ci = Math.max(0, ci - 1); mostrarHist(); });
    E("hsp-x")?.addEventListener("click", cerrarPanel);
    E("hsp-act")?.addEventListener("click", abrirActividad);
    E("hs-act")?.addEventListener("click", abrirActividad);
    E("ha-x")?.addEventListener("click", () => { E("ha-modal").hidden = true; });
    E("hs-env")?.addEventListener("click", enviarMsg);
    E("hs-msg")?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); enviarMsg(); } });
    E("hs-msg")?.addEventListener("focus", () => clearTimeout(vt));
    E("hs-msg")?.addEventListener("blur", () => { if (cola.length && !E("hs-visor").hidden) { clearTimeout(vt); vt = setTimeout(() => { ci++; mostrarHist(); }, 5000); } });
    E("am-x")?.addEventListener("click", () => { E("am-modal").hidden = true; });
    E("am-buscar")?.addEventListener("click", buscarAmigos);
    E("am-q")?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); buscarAmigos(); } });
    E("hc-x")?.addEventListener("click", () => { E("hc-modal").hidden = true; });
    E("hc-txt")?.addEventListener("input", pintarPrevHist);
    E("hc-foto")?.addEventListener("click", () => E("hc-file").click());
    E("hc-file")?.addEventListener("change", async (ev) => { const f = ev.target.files && ev.target.files[0]; if (!f) return; try { fotoBlob = await comprimir(f); E("hc-quitar").hidden = false; pintarPrevHist(); } catch (_) { mostrarAviso("No pude leer esa foto.", "error"); } ev.target.value = ""; });
    E("hc-quitar")?.addEventListener("click", () => { fotoBlob = null; E("hc-quitar").hidden = true; pintarPrevHist(); });
    E("hc-pub")?.addEventListener("click", publicarHist);
    E("sb-premios")?.addEventListener("click", () => { try { if ($("sidebar-menu")?.classList.contains("open")) toggleMenu(); } catch (_) {} setTimeout(abrirPremios, 200); });
    E("pr-x")?.addEventListener("click", () => { E("pr-modal").hidden = true; });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") { cerrarVisor(); cerrarPanel(); E("hc-modal") && (E("hc-modal").hidden = true); E("pr-modal") && (E("pr-modal").hidden = true); } });
    setInterval(() => { if (!document.hidden) { cargarCfg().then(cargarHistorias); } }, 90000);
  }
  supabase.auth.onAuthStateChange(() => { setTimeout(() => { calcPuedeSubir(); cargarHistorias(); }, 600); });
  document.addEventListener("DOMContentLoaded", iniciar);
  return { abrirPremios };
})();

// =====================================================================
// v57 · HUB de chats (Mundial y Alma Zarela fijos) + CHAT PRIVADO entre amigos
// =====================================================================
(function chatHub() {
  const E = (id) => document.getElementById(id);
  const el = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt !== undefined) e.textContent = txt; return e; };
  const esAdm = () => { try { return esAdminActual(); } catch (_) { return false; } };
  const esPC = () => matchMedia("(min-width: 801px)").matches && !document.body.classList.contains("modo-admin");
  const urlFoto = (p) => { try { return supabase.storage.from("chatfotos").getPublicUrl(p).data.publicUrl; } catch (_) { return ""; } };
  const ERR = { NO_AMIGOS: "Solo podés escribirles a tus amigos.", BLOQUEADO: "No se pueden enviar mensajes en este chat.", SILENCIADO: "Estás silenciado por un rato 🤫", MUY_RAPIDO: "Más despacio 🙂", LINK: "No se permiten links ni redes 🚫", PROMO: "No se puede hacer publicidad ni ofrecer recargas acá 🚫", TELEFONO: "No pases teléfonos por acá 🚫. Para tu ID de Free Fire usá el botón 🎮", VENTA: "Eso no se puede enviar 🚫", TEXTO_INVALIDO: "Escribí un mensaje de hasta 300 letras.", FOTOS_APAGADAS: "Las fotos están desactivadas por ahora.", ID_NO_GUARDADO: "Ese ID no está en tu lista de IDs guardados.", NO_AUTENTICADO: "Ingresá con Google primero." };
  const msgErr = (e, d) => { const m = String((e && e.message) || ""); const k = Object.keys(ERR).find((x) => m.includes(x)); return k ? ERR[k] : d; };
  let rafP = 0, activo = null, convs = [], dmCon = null, dmT = 0, fotosModo = "off";
  const PANELES = { hub: "hub-panel", dm: "dm-panel" };

  function pos() { rafP = 0; }
  // v58: chat FIJO arriba a la derecha (debajo del encabezado). No se mueve al scrollear.
  // Cuando la página baja hasta las secciones anchas, el chat se achica a un botón flotante.
  function fijarChat() {
    const rs = document.documentElement.style;
    if (!esPC()) { document.body.classList.remove("chat-mini"); return; }
    const col = document.querySelector(".right-widgets-col"), nav = document.querySelector(".navbar");
    if (!col) return;
    const c = col.getBoundingClientRect(), hb = nav ? Math.round(nav.getBoundingClientRect().bottom + (/fixed|sticky/.test(getComputedStyle(nav).position) ? 0 : scrollY)) : 103;   // posición fija: no depende del scroll
    if (c.width < 50) return;
    const top = Math.max(hb, 0) + 10, h = Math.max(300, Math.min(470, innerHeight - top - 16));  // anclado
    rs.setProperty("--cx", Math.round(c.left) + "px"); rs.setProperty("--cw", Math.round(c.width) + "px");
    rs.setProperty("--cy", top + "px"); rs.setProperty("--ch", h + "px");
    // v60g: el chat va ANCLADO a la página (a la altura de "Ingresar ID") y sube/baja con ella. Opción: dejarlo flotante.
    const card = document.querySelector("h3.h3-cristal") && document.querySelector("h3.h3-cristal").closest(".card");
    const ay = card ? Math.round(card.getBoundingClientRect().top + scrollY) : top;
    rs.setProperty("--cya", ay + "px"); rs.setProperty("--cx", Math.round(c.left + scrollX) + "px");
    const b = document.body, abierto = b.classList.contains("hub-abierto") || b.classList.contains("dm-abierto") || b.classList.contains("cm-abierto") || b.classList.contains("soporte-abierto");
    if (!abierto) { tempDecidido = false; flotaTemp = false; }
    else if (!tempDecidido) { tempDecidido = true; const vis = (ay - scrollY) < innerHeight - 150 && (ay + h - scrollY) > hb + 150; flotaTemp = !vis; }
    b.classList.toggle("chat-fixed", flotaUser || flotaTemp); b.classList.toggle("chat-flota-user", flotaUser);
    if (flotaUser || flotaTemp) rs.setProperty("--cx", Math.round(c.left) + "px");
    const ancho = null; // v60d: el chat ya no se esconde en la burbuja
    let mini = false;
    if (ancho) { const y = ancho.getBoundingClientRect().top; mini = y < top + h + 12; }
    const antes = document.body.classList.contains("chat-mini");
    document.body.classList.toggle("chat-mini", mini);
    if (!mini) forzadoMini = false;
    if (mini && !antes && !forzadoMini && (activo || document.body.classList.contains("soporte-abierto"))) { try { todoCerrado(); } catch (_) {} }
  }
  let forzadoMini = false;
  let flotaUser = false; try { flotaUser = localStorage.getItem("zarela_chat_flota") === "1"; } catch (_) {}
  let flotaTemp = false, tempDecidido = false;
  function alternarFlota() { flotaUser = !flotaUser; try { localStorage.setItem("zarela_chat_flota", flotaUser ? "1" : "0"); } catch (_) {} tempDecidido = false; fijarChat(); }
  { // arrastrar el chat cuando está en modo flotante (desde su barra de arriba)
    let d = null;
    document.addEventListener("pointerdown", (e) => { if (!flotaUser || !esPC()) return; const hd = e.target.closest && e.target.closest(".cm-top,.chat-widget-header"); if (!hd || e.target.closest("button,a,input,select")) return; const p = hd.closest(".cm-panel,.hub-panel,.dm-panel,.chat-widget-card"); if (!p) return; const r = p.getBoundingClientRect(); d = { x: e.clientX, y: e.clientY, l: r.left, t: r.top, w: r.width, h: r.height }; });
    document.addEventListener("pointermove", (e) => { if (!d) return; const l = Math.min(Math.max(0, d.l + e.clientX - d.x), innerWidth - d.w), t = Math.min(Math.max(0, d.t + e.clientY - d.y), innerHeight - d.h); const rs = document.documentElement.style; rs.setProperty("--fx", Math.round(l) + "px"); rs.setProperty("--fy", Math.round(t) + "px"); });
    document.addEventListener("pointerup", () => { if (!d) return; d = null; try { const rs = document.documentElement.style; localStorage.setItem("zarela_chat_pos", JSON.stringify([rs.getPropertyValue("--fx"), rs.getPropertyValue("--fy")])); } catch (_) {} });
    try { const g = JSON.parse(localStorage.getItem("zarela_chat_pos") || "null"); if (g) { document.documentElement.style.setProperty("--fx", g[0]); document.documentElement.style.setProperty("--fy", g[1]); } } catch (_) {}
    new MutationObserver(() => pedirFijar()).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }
  let fcT = 0; const pedirFijar = () => { if (!fcT) fcT = requestAnimationFrame(() => { fcT = 0; fijarChat(); }); };
  addEventListener("scroll", pedirFijar, { passive: true }); addEventListener("resize", pedirFijar);
  setTimeout(fijarChat, 300); setTimeout(fijarChat, 1500); setTimeout(fijarChat, 4000);
  function cerrarPaneles(salvo) {
    Object.entries(PANELES).forEach(([k, id]) => { if (k === salvo) return; const w = E(id); if (w) { w.classList.remove("abierto"); w.style.cssText = ""; } document.body.classList.remove(k + "-abierto"); });
    if (salvo !== "dm") { clearTimeout(dmT); dmCon = null; }
  }
  function abrirPanel(k) {
    cerrarPaneles(k); document.body.classList.remove("soporte-abierto"); try { window.cerrarChatMundo && window.cerrarChatMundo(); } catch (_) {}
    try { if (!esPC() && typeof alternarChat === "function") alternarChat(false); } catch (_) {}
    const w = E(PANELES[k]); w.classList.add("abierto"); document.body.classList.add(k + "-abierto"); activo = k;
    if (document.body.classList.contains("chat-mini")) forzadoMini = true;
    if (esPC()) { cancelAnimationFrame(rafP); rafP = requestAnimationFrame(() => pos(PANELES[k])); }
  }
  function todoCerrado() { document.body.classList.remove("soporte-abierto"); cerrarPaneles(null); try { window.cerrarChatMundo && window.cerrarChatMundo(); } catch (_) {} activo = null; }

  // ------------------------- HUB -------------------------
  async function cargarConvs() {
    if (!usuarioActual) { convs = []; return; }
    try { const { data, error } = await supabase.rpc("dm_conversaciones"); if (error) throw error; convs = data || []; } catch (_) { convs = []; }
  }
  const hora = (t) => { try { const d = new Date(t), h = new Date(); return d.toDateString() === h.toDateString() ? d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" }); } catch (_) { return ""; } };
  function avatar(nombre, foto, c) {
    const a = el("span", "hub-av " + (c || "")); const ini = () => { a.textContent = (nombre || "?").trim().charAt(0).toUpperCase(); };
    if (foto && /^https:\/\//.test(foto)) { const im = el("img"); im.alt = ""; im.referrerPolicy = "no-referrer"; im.onerror = () => { im.remove(); ini(); }; im.src = foto; a.appendChild(im); } else ini(); return a;
  }
  function fila(av, tit, sub, meta, n, fijado, fn) {
    const b = el("button", "hub-fila" + (fijado ? " fij" : "")); b.type = "button"; b.appendChild(av);
    const t = el("div", "hub-t"); const h = el("div", "hub-h"); { const bb = el("b", "", tit.replace(" ✔ Oficial", "")); if (/ ✔ Oficial$/.test(tit)) { bb.appendChild(el("span", "vf-of", "✔")); bb.appendChild(el("span", "of-tag", "Oficial")); } h.appendChild(bb); }  t.appendChild(h); t.appendChild(el("small", "", sub)); b.appendChild(t);
    const m = el("div", "hub-m"); if (meta) m.appendChild(el("small", "", meta)); if (n) m.appendChild(el("em", "hub-n", n > 99 ? "99+" : String(n))); b.appendChild(m); b.onclick = fn; if (n) b.classList.add("nl"); if (soloNL && !n) b.hidden = true; return b;
  }
  let soloNL = false;
  async function pintarHub() {
    const l = E("hub-lista"); if (!l) return;
    await cargarConvs();
    l.innerHTML = "";
    if (soloNL) { const av = el("button", "hub-aviso", "🔵 Mostrando solo no leídos · tocá para ver todos"); av.type = "button"; av.onclick = () => { soloNL = false; pintarHub(); }; l.appendChild(av); }
    const mundo = el("span", "hub-av hub-mundo", "🌎");
    let ult = "Chateá con todos los clientes"; try { const ms = document.querySelectorAll("#cm-lista .cm-msg .cm-txt"); if (ms.length) ult = ms[ms.length - 1].textContent; } catch (_) {}
    l.appendChild(fila(mundo, "Mundial", ult.slice(0, 48), "", (window.cmSinLeer && window.cmSinLeer()) || 0, true, () => { cerrarPaneles(null); window.abrirChatMundo(); }));
    let sop = "Dudas, comprobantes y ayuda"; try { const ms = document.querySelectorAll("#chat-messages-container .chat-message"); if (ms.length) sop = ms[ms.length - 1].textContent.trim().replace(/\s+/g, " "); } catch (_) {}
    let nsop = 0; try { nsop = parseInt((document.querySelector("#chat-fab .chat-dot:not(#hub-dot)") || {}).textContent, 10) || 0; } catch (_) {}
    const fSop = perfilSoporte && perfilSoporte.avatar_url;
    l.appendChild(fila(fSop ? avatar("Alma Zarela", fSop, "hub-sop") : el("span", "hub-av hub-sop", "💎"), "Alma Zarela ✔ Oficial", sop.slice(0, 48), "", nsop, true, () => { cerrarPaneles(null); activo = null; document.body.classList.add("soporte-abierto"); try { if (!esPC()) alternarChat(true); } catch (_) {} }));
    l.appendChild(el("div", "hub-sep"));
    if (!usuarioActual) l.appendChild(el("p", "hub-vacio", "Ingresá con Google para agregar amigos y escribirles."));
    else if (!convs.length) l.appendChild(el("p", "hub-vacio", "Todavía no tenés amigos. Tocá «＋ Agregar amigos» para buscarlos por nombre o por ID."));
    convs.forEach((c) => l.appendChild(fila(avatar(c.nombre, c.foto), c.nombre, c.ult_texto ? (c.ult_mio ? "Vos: " : "") + (c.ult_tipo === "id" ? "🎮 ID de Free Fire" : c.ult_tipo === "foto" ? "📷 Foto" : c.ult_texto).slice(0, 44) : "Escribile para jugar juntos 🎮", c.ult_at ? hora(c.ult_at) : "", Number(c.no_leidos) || 0, false, () => abrirDM(c))));
    pintarPunto();
  }
  async function pintarPunto() {
    let n = 0; if (usuarioActual) { try { const { data } = await supabase.rpc("dm_total_no_leidos"); n = Number(data) || 0; } catch (_) {} }
    let s = 0; try { s = parseInt((document.querySelector("#chat-fab .chat-dot:not(#hub-dot)") || {}).textContent, 10) || 0; } catch (_) {}
    const t = n + s + ((window.cmSinLeer && window.cmSinLeer()) || 0), d = E("hub-dot"); if (d) { d.textContent = t > 99 ? "99+" : String(t); d.hidden = !t; }
  }
  window.cerrarPanelesChat = () => cerrarPaneles(null);
  window.abrirHub = async () => { abrirPanel("hub"); pintarHub(); };
  window.abrirChatSoporte = () => { todoCerrado(); document.body.classList.add("soporte-abierto"); try { if (!esPC() && typeof alternarChat === "function") alternarChat(true); } catch (_) {} };

  // ------------------------- CHAT PRIVADO -------------------------
  async function cargarModoFotos() { try { const { data } = await supabase.from("novedades_config").select("valor").eq("clave", "dm_fotos").maybeSingle(); fotosModo = (data && data.valor) || "off"; } catch (_) {} E("dm-fotob").hidden = fotosModo === "off" && !esAdm(); }
  async function abrirDM(c) {
    dmCon = c; abrirPanel("dm"); E("dm-nom").textContent = c.nombre; E("dm-sub").textContent = "#" + c.num_id + " · amigo"; const av = E("dm-av"); av.innerHTML = ""; av.appendChild(avatar(c.nombre, c.foto, "hub-av-s"));
    E("dm-lista").innerHTML = ""; E("dm-in").value = "";
    { const ch = E("dm-chips"); if (ch) { ch.innerHTML = ""; ch.hidden = true; } }
    cargarModoFotos(); await cargarDM(true);
  }
  async function cargarDM(forzar) {
    clearTimeout(dmT); if (!dmCon || activo !== "dm") return;
    const id = dmCon.id;
    try {
      const { data, error } = await supabase.rpc("dm_lista", { p_con: id }); if (error) throw error;
      if (dmCon && dmCon.id === id) pintarDM((data || []).slice().reverse(), forzar);
    } catch (_) {}
    dmT = setTimeout(() => cargarDM(false), 4000);
  }
  function pintarDM(ms, forzar) {
    const l = E("dm-lista"), abajo = l.scrollHeight - l.scrollTop - l.clientHeight < 80, firma = ms.map((m) => m.id + m.estado + m.leido + JSON.stringify(m.rx || [])).join(",");
    if (!forzar && l.dataset.f === firma) return; l.dataset.f = firma; l.innerHTML = "";
    if (!ms.length) l.appendChild(el("p", "cm-vacio", "Saluda a " + (dmCon ? dmCon.nombre : "tu amigo") + " 👋 ¿Juegan juntos el torneo?"));
    ms.forEach((m) => {
      const d = el("div", "cm-msg dm-m" + (m.mio ? " cm-mio" : ""));
      if (m.tipo === "id") { const c = el("div", "dm-idc"); c.appendChild(el("small", "", "🎮 ID de Free Fire")); c.appendChild(el("b", "", m.texto)); const b = el("button", "pr-mini", "Copiar"); b.type = "button"; b.onclick = () => { try { navigator.clipboard.writeText(m.texto); mostrarAviso("ID copiado", "exito"); } catch (_) {} }; c.appendChild(b); d.appendChild(c); }
      else if (m.tipo === "foto") { const im = el("img", "dm-foto"); im.alt = "foto"; im.src = urlFoto(m.foto_path); im.onclick = () => { const z = E("dm-zoom"); z.querySelector("img").src = im.src; z.hidden = false; }; d.appendChild(im); if (m.texto) d.appendChild(el("div", "cm-txt", m.texto)); }
      else d.appendChild(el("div", "cm-txt", m.texto));
      const pie = el("small", "dm-pie", hora(m.created_at) + (m.mio ? (m.estado === "revision" ? " · ⏳ en revisión" : m.leido ? " ✓✓" : " ✓") : "")); d.appendChild(pie);
      mantenerPresionado(d, (x, y) => {
        const ops = [];
        if (m.texto && m.tipo !== "foto") ops.push(["📋", "Copiar", () => { try { navigator.clipboard.writeText(m.texto); mostrarAviso("Copiado", "exito"); } catch (_) {} }]);
        ops.push(["↩️", "Responder", () => { const i = E("dm-in"); if (i) i.focus(); }]);
        if (!m.mio) ops.push(["🚩", "Reportar", async () => { try { await supabase.rpc("dm_reportar", { p_id: m.id }); mostrarAviso("Gracias, lo revisamos 🙏", "exito"); } catch (_) {} }, true]);
        menuHold(x, y, ops, m.estado === "ok" ? ["❤️", "🔥", "😂", "😮", "👏", "👍"].map((e) => ({ e, fn: () => reaccionarDM(m.id, e) })) : null);
      });
      if (m.estado === "ok") {
        if ((m.rx || []).length) { const rr = el("div", "dm-rx"); m.rx.forEach((z) => { const b = el("button", "dm-rxc" + (z.mia ? " mia" : ""), z.e + (z.n > 1 ? " " + z.n : "")); b.type = "button"; b.onclick = () => reaccionarDM(m.id, z.e); rr.appendChild(b); }); d.appendChild(rr); }
      }
      l.appendChild(d);
    });
    if (abajo || forzar) l.scrollTop = l.scrollHeight;
  }
  async function reaccionarDM(id, emoji) {
    try { const { error } = await supabase.rpc("dm_reaccionar", { p_id: id, p_emoji: emoji }); if (error) throw error; await cargarDM(true); }
    catch (_) { mostrarAviso("No se pudo reaccionar ahora.", "error"); }
  }
  window.abrirDMCon = (c) => abrirDM(c);
  let envDM = false;
  async function enviarDM(texto, tipo, path) {
    if (!dmCon || envDM) return; if (tipo === "texto" && !texto.trim()) return;
    envDM = true;
    try { const { data, error } = await supabase.rpc("dm_enviar", { p_para: dmCon.id, p_texto: texto, p_tipo: tipo, p_path: path || null }); if (error) throw error; if (tipo === "texto" && texto === E("dm-in").value) E("dm-in").value = ""; if (data && data.estado === "revision") mostrarAviso("Tu mensaje quedó en revisión 🔎", "info"); await cargarDM(true); }
    catch (e) { mostrarAviso(msgErr(e, "No se pudo enviar."), "error"); }
    envDM = false;
  }
  async function compartirId() {
    const m = E("dm-ids"), l = E("dm-ids-l"); l.textContent = "Cargando…"; m.hidden = false;
    try { const { data } = await supabase.from("ids_guardados").select("id_jugador, apodo").order("created_at", { ascending: false }).limit(8); l.innerHTML = "";
      if (!data || !data.length) { l.appendChild(el("p", "adm-ayuda", "Primero guardá tu ID en la página (sección «Ingresar ID de jugador»). Así nadie puede mandar un ID que no es suyo.")); return; }
      data.forEach((x) => { const b = el("button", "dm-idop"); b.type = "button"; b.appendChild(el("b", "", x.id_jugador)); b.appendChild(el("small", "", x.apodo || "ID guardado")); b.onclick = () => { m.hidden = true; enviarDM(x.id_jugador, "id"); }; l.appendChild(b); });
    } catch (_) { l.textContent = "No se pudo cargar tus IDs."; }
  }
  function comprimirJPG(file) { return new Promise((res, rej) => { const im = new Image(), u = URL.createObjectURL(file); im.onload = () => { const k = Math.min(1, 900 / Math.max(im.width, im.height)); const cv = document.createElement("canvas"); cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k); cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height); cv.toBlob((b) => (b ? res(b) : rej()), "image/jpeg", 0.78); URL.revokeObjectURL(u); }; im.onerror = rej; im.src = u; }); }
  async function menuDM() {
    if (!dmCon) return;
    const bloq = !!dmCon.bloqueado;
    if (confirm(bloq ? "¿Desbloquear a " + dmCon.nombre + "?" : "¿Bloquear a " + dmCon.nombre + "? No podrán escribirse.")) { try { await supabase.rpc("dm_bloquear", { p_user: dmCon.id, p_si: !bloq }); dmCon.bloqueado = !bloq; mostrarAviso(bloq ? "Desbloqueado" : "Bloqueado", "exito"); } catch (_) {} }
  }
  function iniciar() {
    E("hub-x")?.addEventListener("click", () => { todoCerrado(); });
    E("hub-menu")?.addEventListener("click", (e) => { e.stopPropagation(); menuNoLeidos(E("hub-menu"), () => soloNL, (v) => { soloNL = v; pintarHub(); }, esPC() ? [[flotaUser ? "📍 Anclar el chat a la página" : "🪟 Dejar el chat flotante (movible)", alternarFlota]] : []); });
    E("hub-amg")?.addEventListener("click", () => window.abrirAmigos && window.abrirAmigos(""));
    E("chat-volver")?.addEventListener("click", () => { try { if (!esPC()) alternarChat(false); } catch (_) {} window.abrirHub(); });
    E("dm-back")?.addEventListener("click", () => window.abrirHub());
    E("dm-menu")?.addEventListener("click", menuDM);
    const verPerfilDM = () => { if (dmCon && window.abrirPerfil) window.abrirPerfil(dmCon.id); };
    E("dm-av")?.addEventListener("click", verPerfilDM); document.querySelector(".dm-quien")?.addEventListener("click", verPerfilDM);
    document.querySelector(".chat-agente")?.addEventListener("click", () => { if (perfilSoporte && perfilSoporte.user_id && window.abrirPerfil) window.abrirPerfil(perfilSoporte.user_id); });
    document.querySelector(".chat-cerrar")?.addEventListener("click", () => { if (esPC()) todoCerrado(); });
    E("dm-env")?.addEventListener("click", () => enviarDM(E("dm-in").value, "texto"));
    E("dm-in")?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); enviarDM(E("dm-in").value, "texto"); } });
    E("dm-idb")?.addEventListener("click", compartirId);
    E("dm-ids-x")?.addEventListener("click", () => { E("dm-ids").hidden = true; });
    E("dm-fotob")?.addEventListener("click", () => E("dm-file").click());
    E("dm-zoom")?.addEventListener("click", () => { E("dm-zoom").hidden = true; });
    E("dm-file")?.addEventListener("change", async (ev) => { const f = ev.target.files && ev.target.files[0]; ev.target.value = ""; if (!f || !dmCon) return; try { const b = await comprimirJPG(f); const path = usuarioActual.id + "/" + Date.now() + ".jpg"; const { error } = await supabase.storage.from("chatfotos").upload(path, b, { contentType: "image/jpeg" }); if (error) throw error; await enviarDM("", "foto", path); } catch (e) { mostrarAviso(msgErr(e, "No se pudo enviar la foto."), "error"); } });
    setInterval(() => { if (!document.hidden) { pintarPunto(); if (activo === "hub") pintarHub(); } }, 20000);
    setTimeout(pintarPunto, 4000);
    // PC: la lista de chats es lo primero que se ve en el lugar del chat
    setTimeout(() => { if (esPC() && !activo && !document.body.classList.contains("tour-on") && !document.body.classList.contains("chat-mini")) window.abrirHub(); }, 500);
  }
  supabase.auth.onAuthStateChange(() => { setTimeout(() => { pintarPunto(); if (activo === "hub") pintarHub(); }, 700); });
  document.addEventListener("DOMContentLoaded", iniciar);
})();


// =====================================================================
// v58 · PERFILES (con Me gusta), insignia ✔, bienvenida, link de amigos, avisos
// =====================================================================
(function perfilesMod() {
  const E = (id) => document.getElementById(id);
  const el = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt !== undefined) e.textContent = txt; return e; };
  const FONDOS = [["f1", "linear-gradient(135deg,#0f2a5c,#2b7bff)"], ["f2", "linear-gradient(135deg,#3b0f33,#ec4899)"], ["f3", "linear-gradient(135deg,#0b3d2e,#19e68c)"], ["f4", "linear-gradient(135deg,#2a1a5e,#a855f7)"], ["f5", "linear-gradient(135deg,#5a2a00,#f59e0b)"], ["f6", "linear-gradient(135deg,#4a0d0d,#ef4444)"], ["f7", "linear-gradient(135deg,#102a43,#38bdf8,#19e68c)"], ["f8", "linear-gradient(135deg,#0b0b12,#4b5563)"]];
  const ORO = "linear-gradient(135deg,#3a2a00,#c98f0a 45%,#ffe58a 75%,#c98f0a)";
  const NIVRGB = ["226,150,86", "205,218,238", "255,205,70", "110,235,225", "70,160,255", "255,95,40", "190,100,255", "255,190,70"];
  const nivCss = (i) => "linear-gradient(135deg,rgba(" + NIVRGB[i] + ",.85),rgba(" + NIVRGB[i] + ",.25) 55%,#0b0b12)";
  const fondoCss = (k, oro) => { const m = /^n([0-7])$/.exec(k || ""); if (m) return nivCss(Number(m[1])); return oro && !k ? ORO : (FONDOS.find((x) => x[0] === k) || (oro ? ["", ORO] : FONDOS[0]))[1]; };
  const urlPortada = (p) => { try { return supabase.storage.from("chatfotos").getPublicUrl(p).data.publicUrl; } catch (_) { return ""; } };
  const coverCss = (p) => (p.portada ? "linear-gradient(rgba(0,0,0,.15),rgba(0,0,0,.15)),url('" + urlPortada(p.portada) + "') center/cover" : fondoCss(p.fondo, p.es_soporte));
  const comprimir = (file) => new Promise((res, rej) => { const im = new Image(), u = URL.createObjectURL(file); im.onload = () => { const k = Math.min(1, 1100 / Math.max(im.width, im.height)); const cv = document.createElement("canvas"); cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k); cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height); cv.toBlob((b) => (b ? res(b) : rej()), "image/jpeg", 0.72); URL.revokeObjectURL(u); }; im.onerror = rej; im.src = u; });
  const fmtN = (n) => Number(n || 0).toLocaleString("es-AR");
  const ERR = { LINK: "No se permiten links ni redes en tu descripción 🚫", RUTA_INVALIDA: "Esa foto no se pudo usar.", TELEFONO: "No pongas teléfonos 🚫", PROMO: "No se puede hacer publicidad en tu descripción 🚫", VENTA: "Esa descripción no está permitida 🚫", TEXTO_INVALIDO: "Hasta 140 letras.", NO_DISPONIBLE: "La insignia todavía no está disponible.", REQUISITO: "Todavía no cumplís los requisitos." };
  const msgErr = (e, d) => { const m = String((e && e.message) || ""); const k = Object.keys(ERR).find((x) => m.includes(x)); return k ? ERR[k] : d; };
  const yo = () => (usuarioActual ? usuarioActual.id : null);
  const cerrar = () => { const m = E("pf-modal"); if (m) m.hidden = true; };
  let vEstado = null;
  async function cargarVerif() { try { const { data } = await supabase.rpc("verif_estado"); vEstado = data || null; } catch (_) { vEstado = null; } return vEstado; }
  const cfgV = (k, d) => { const v = vEstado && vEstado.cfg ? vEstado.cfg[k] : null; return v == null || v === "" ? d : v; };

  async function abrirPerfil(uid) {
    if (!uid) return;
    const m = E("pf-modal"), card = E("pf-card"); if (!m || !card) return;
    m.hidden = false; card.innerHTML = ""; card.appendChild(el("p", "pf-carga", "Cargando perfil…"));
    let p = null;
    try { const { data, error } = await supabase.rpc("perfil_publico", { p_id: uid }); if (error) throw error; p = data; } catch (_) {}
    if (!p) { card.innerHTML = ""; card.appendChild(botonX()); card.appendChild(el("p", "pf-carga", "No pude cargar este perfil. (¿Ejecutaste el SQL v43?)")); return; }
    if (p.verificado || p.es_soporte) verifUsr.add(p.id);
    perfPub[p.id] = Object.assign(perfPub[p.id] || {}, { id: p.id, nombre: p.nombre, foto: p.foto, num_id: p.num_id, verificado: p.verificado, es_soporte: p.es_soporte });
    if (p.yo && !p.es_soporte) await cargarVerif();
    pintarPerfil(p, false);
  }
  const botonX = () => { const b = el("button", "pf-x", "✕"); b.type = "button"; b.setAttribute("aria-label", "Cerrar"); b.onclick = cerrar; return b; };

  function pintarPerfil(p, editando) {
    const card = E("pf-card"); card.innerHTML = ""; card.className = "pf-card" + (p.es_soporte ? " pf-oro" : "");
    const cov = el("div", "pf-cover"); cov.style.background = coverCss(p); card.appendChild(cov);
    const vol = el("button", "pf-volver", "‹ Volver"); vol.type = "button"; vol.onclick = cerrar; card.appendChild(vol); card.appendChild(botonX());
    const av = el("div", "pf-av"); av.appendChild(miniAv(p.nombre, p.foto, "pf-av-i")); card.appendChild(av);
    const cu = el("div", "pf-cuerpo"); card.appendChild(cu);
    // nombre + sellos
    const nom = el("div", "pf-nom"); nom.appendChild(el("h3", "", p.nombre));
    if (p.es_soporte) nom.appendChild(el("span", "pf-sello-of", "✔ Oficial"));
    else if (p.verificado) { const v = selloVerif(); v.classList.add("pf-vf"); nom.appendChild(v); }
    cu.appendChild(nom);
    const sub = el("div", "pf-sub"); if (p.es_soporte && p.titulo) sub.appendChild(el("b", "", p.titulo)); else if (p.es_soporte) sub.appendChild(el("b", "", "Soporte de Recargas Zarela"));
    if (p.num_id) sub.appendChild(el("span", "pf-num", "#" + p.num_id));
    try { if (p.desde) sub.appendChild(el("span", "", "Desde " + new Date(p.desde).toLocaleDateString("es-AR", { month: "short", year: "numeric" }))); } catch (_) {}
    cu.appendChild(sub);
    const ni = !p.es_soporte && typeof nivelDe === "function" ? nivelDe(Number(p.diamantes) || 0) : -1;
    if (ni >= 0 && NIVELES[ni]) { const b = el("span", "niv-ins n" + ni, NIVELES[ni].ico + " " + NIVELES[ni].n); b.title = "Nivel " + NIVELES[ni].n; cu.appendChild(b); }
    if (editando) return pintarEditor(p, cu);
    // descripción
    cu.appendChild(el("p", "pf-bio" + (p.bio ? "" : " vacio"), p.bio || (p.yo ? "Todavía no escribiste nada sobre vos. ¡Tocá «Editar perfil»!" : p.es_soporte ? "Estamos para ayudarte con tus recargas 💎" : "Sin descripción todavía.")));
    // números
    const st = el("div", "pf-stats");
    const dato = (n, t) => { const d = el("div", "pf-dato"); d.appendChild(el("b", "", n)); d.appendChild(el("small", "", t)); st.appendChild(d); return d; };
    dato(fmtN(p.recargas), p.es_soporte ? "Recargas entregadas a clientes" : "Recargas"); dato(fmtN(p.diamantes) + " 💎", p.es_soporte ? "Diamantes entregados a clientes" : "Diamantes");
    const dl = dato(fmtN(p.likes), "Me gusta ❤️"); if (!p.es_soporte) dato(fmtN(p.amigos), "Amigos");
    cu.appendChild(st);
    // acciones
    const ac = el("div", "pf-acc"); cu.appendChild(ac);
    if (p.yo) {
      const e = el("button", "al-ok", "✏️ Editar perfil"); e.type = "button"; e.onclick = () => pintarPerfil(p, true); ac.appendChild(e);
      if (!p.es_soporte) pintarVerif(cu, p);
    } else {
      const txtLk = () => (p.mi_like ? "❤️ Ya le diste Me gusta hoy" : "🤍 Me gusta");
      const lk = el("button", "pf-like" + (p.mi_like ? " on" : ""), txtLk()); lk.type = "button"; lk.disabled = !!p.mi_like; lk.title = "Podés darle un Me gusta por día a cada persona";
      lk.onclick = async () => { if (!usuarioActual) { mostrarAviso("Ingresá con Google para dar Me gusta.", "info"); try { window.loginConGoogle(); } catch (_) {} return; }
        try { const { data, error } = await supabase.rpc("perfil_like", { p_user: p.id }); if (error) throw error; p.mi_like = true; p.likes = data.likes; lk.className = "pf-like on"; lk.textContent = txtLk(); lk.disabled = true; dl.firstChild.textContent = fmtN(p.likes); mostrarAviso("❤️ ¡Listo! Mañana podés darle otro.", "exito"); }
        catch (e) { if (String((e && e.message) || "").includes("YA_HOY")) { p.mi_like = true; lk.className = "pf-like on"; lk.textContent = txtLk(); lk.disabled = true; mostrarAviso("Hoy ya le diste Me gusta. ¡Volvé mañana! ❤️", "info"); } else mostrarAviso("No se pudo ahora.", "error"); } };
      ac.appendChild(lk);
      if (p.es_soporte) { const w = el("button", "al-ok", "💬 Escribir a Soporte"); w.type = "button"; w.onclick = () => { cerrar(); window.abrirChatSoporte && window.abrirChatSoporte(); }; ac.appendChild(w); }
      else {
        const r = p.relacion;
        if (r === "amigos") { const w = el("button", "al-ok", "💬 Escribir"); w.type = "button"; w.onclick = () => { cerrar(); window.abrirDMCon && window.abrirDMCon({ id: p.id, nombre: p.nombre, num_id: p.num_id, foto: p.foto }); }; ac.appendChild(w); }
        else if (r === "enviada") { const w = el("button", "pf-sec", "Solicitud enviada ✔"); w.type = "button"; w.disabled = true; ac.appendChild(w); }
        else { const w = el("button", "al-ok", r === "recibida" ? "✔ Aceptar amistad" : "＋ Agregar amigo"); w.type = "button";
          w.onclick = async () => { if (!usuarioActual) { mostrarAviso("Ingresá con Google para agregar amigos.", "info"); try { window.loginConGoogle(); } catch (_) {} return; }
            try { const { error } = await supabase.rpc(r === "recibida" ? "amigo_responder" : "amigo_pedir", r === "recibida" ? { p_user: p.id, p_ok: true } : { p_user: p.id }); if (error) throw error; mostrarAviso(r === "recibida" ? "¡Ahora son amigos! 🎉" : "Solicitud enviada 🤝", "exito"); abrirPerfil(p.id); } catch (e) { mostrarAviso("No se pudo ahora.", "error"); } };
          ac.appendChild(w); }
      }
    }
  }

  function pintarVerif(cu, p) {
    const caja = el("div", "pf-verif"); cu.appendChild(caja);
    const v = vEstado; if (!v) return;
    const on = String(cfgV("f_verif", "off")) === "on";
    caja.appendChild(el("h5", "", "✔ Insignia de verificación"));
    if (v.activo) { caja.appendChild(el("p", "", "¡Tu cuenta está verificada! 🎉" + (v.hasta ? " Vence el " + new Date(v.hasta).toLocaleDateString("es-AR") + "." : ""))); return; }
    if (!on) { caja.appendChild(el("p", "pf-chico", "Muy pronto vas a poder pedir tu insignia ✔ para que todos vean que sos un cliente de confianza.")); return; }
    const min = Number(cfgV("verif_min_recargas", 3)), pa = Number(cfgV("verif_precio_ars", 0)), pu = Number(cfgV("verif_precio_usd", 0)), dias = Number(cfgV("verif_dias", 0));
    caja.appendChild(el("p", "", "La insignia ✔ aparece al lado de tu nombre en comentarios, chats y tu perfil: muestra que sos un cliente de confianza."));
    const ul = el("ul", "pf-req");
    ul.appendChild(el("li", "", (v.recargas >= min ? "✅ " : "⬜ ") + "Tener " + min + " recargas completadas (vos tenés " + v.recargas + ")"));
    ul.appendChild(el("li", "", (pa > 0 || pu > 0) ? "💳 Precio: " + [pa > 0 ? "$" + fmtN(pa) + " ARS" : "", pu > 0 ? "US$ " + fmtN(pu) : ""].filter(Boolean).join(" o ") + (dias > 0 ? " por " + dias + " días" : " (una sola vez)") + " · se abona con Zarela por el chat de soporte" : "🎁 Es gratis: la revisa Zarela"));
    caja.appendChild(ul);
    if (v.pedido) { caja.appendChild(el("div", "pr-ok", "Pedido enviado ✅ Zarela te escribe por el chat de soporte.")); return; }
    const b = el("button", "al-ok", "Pedir mi insignia ✔"); b.type = "button"; b.disabled = v.recargas < min;
    b.onclick = async () => { b.disabled = true; try { const { error } = await supabase.rpc("verif_pedir"); if (error) throw error; mostrarAviso("¡Pedido enviado! Zarela te escribe por soporte ✔", "exito"); await cargarVerif(); pintarPerfil(p, false); } catch (e) { mostrarAviso(msgErr(e, "No se pudo enviar el pedido."), "error"); b.disabled = false; } };
    caja.appendChild(b);
  }

  function pintarEditor(p, cu) {
    if (!p.es_soporte) { const bn = el("button", "pf-nombre", "✏️ Cambiar mi nombre y foto"); bn.type = "button"; bn.onclick = () => { try { window.abrirAlias(); } catch (_) {} }; cu.appendChild(bn);
      const al = E("al-modal"); if (al && !al.dataset.pfObs) { al.dataset.pfObs = "1"; new MutationObserver(() => { if (al.hidden && !E("pf-modal").hidden) { if (usuarioActual && window.abrirPerfil) window.abrirPerfil(usuarioActual.id); } }).observe(al, { attributes: true, attributeFilter: ["hidden"] }); } }
    const bio = el("textarea", "pf-ta"); bio.maxLength = 140; bio.rows = 3; bio.value = p.bio || ""; bio.placeholder = p.es_soporte ? "Escribí tu presentación…" : "Contá algo sobre vos (máx. 140 letras, sin links ni teléfonos)";
    cu.appendChild(el("label", "pf-lab", "Descripción")); cu.appendChild(bio);
    let tit = null; if (p.es_soporte) { cu.appendChild(el("label", "pf-lab", "Título (debajo de tu nombre)")); tit = el("input", "pf-in"); tit.maxLength = 40; tit.value = p.titulo || ""; tit.placeholder = "Ej: Dueña · Soporte de Recargas Zarela"; cu.appendChild(tit); }
    cu.appendChild(el("label", "pf-lab", "Fondo de tu perfil"));
    let sel = p.fondo || "", portada = null, subiendo = false; const sw = el("div", "pf-sw");
    const cover = () => E("pf-card").querySelector(".pf-cover");
    const mk = (k, css, bloq, tit) => { const b = el("button", "pf-fb" + (sel === k && !p.portada ? " on" : "") + (bloq ? " bloq" : "")); b.type = "button"; b.style.background = css; if (tit) b.title = tit;
      b.onclick = () => { if (bloq) { mostrarAviso(tit, "info"); return; } sel = k; portada = ""; p.portada = null; sw.querySelectorAll(".pf-fb").forEach((x) => x.classList.remove("on")); b.classList.add("on"); const c = cover(); if (c) c.style.background = fondoCss(k, p.es_soporte); }; sw.appendChild(b); };
    if (p.es_soporte) mk("", ORO); FONDOS.forEach(([k, css]) => mk(k, css)); cu.appendChild(sw);
    if (!p.es_soporte) {
      const miNiv = nivelDe(Number(p.diamantes) || 0);
      cu.appendChild(el("label", "pf-lab", "Fondos de tus niveles 🏆"));
      const sw2 = el("div", "pf-sw"); cu.appendChild(sw2);
      NIVELES.forEach((n, i) => { const b = el("button", "pf-fb" + (sel === "n" + i && !p.portada ? " on" : "") + (i > miNiv ? " bloq" : "")); b.type = "button"; b.style.background = nivCss(i); b.textContent = i > miNiv ? "🔒" : n.ico; const tit = i > miNiv ? "Se desbloquea al llegar al nivel " + n.n : "Nivel " + n.n;
        b.title = tit; b.onclick = () => { if (i > miNiv) { mostrarAviso(tit, "info"); return; } sel = "n" + i; portada = ""; p.portada = null; document.querySelectorAll("#pf-card .pf-fb").forEach((x) => x.classList.remove("on")); b.classList.add("on"); const c = cover(); if (c) c.style.background = nivCss(i); }; sw2.appendChild(b); });
    }
    cu.appendChild(el("label", "pf-lab", "O poné tu propia foto de portada 📷"));
    const fr = el("div", "pf-acc"); const fi = el("input"); fi.type = "file"; fi.accept = "image/*"; fi.hidden = true;
    const bf = el("button", "pf-sec", "📷 Elegir foto de portada"); bf.type = "button"; bf.onclick = () => fi.click();
    const bq = el("button", "pf-sec", "Quitar portada"); bq.type = "button"; bq.hidden = !p.portada; bq.onclick = () => { portada = ""; p.portada = null; bq.hidden = true; const c = cover(); if (c) c.style.background = fondoCss(sel, p.es_soporte); };
    fi.onchange = async () => { const f = fi.files && fi.files[0]; fi.value = ""; if (!f) return; subiendo = true; bf.textContent = "Subiendo…";
      try { const blob = await comprimir(f); const path = usuarioActual.id + "/portada-" + Date.now() + ".jpg"; const { error } = await supabase.storage.from("chatfotos").upload(path, blob, { contentType: "image/jpeg", upsert: false }); if (error) throw error; portada = path; p.portada = path; bq.hidden = false; const c = cover(); if (c) c.style.background = coverCss(p); sw.querySelectorAll(".pf-fb").forEach((x) => x.classList.remove("on")); }
      catch (_) { mostrarAviso("No se pudo subir la foto. Probá con otra.", "error"); }
      subiendo = false; bf.textContent = "📷 Elegir foto de portada"; };
    fr.append(bf, bq, fi); cu.appendChild(fr);
    cu.appendChild(el("p", "pf-chico", "Tu foto es la de tu cuenta de Google. Si la cambiás ahí, acá se actualiza sola."));
    const ac = el("div", "pf-acc"); cu.appendChild(ac);
    const g = el("button", "al-ok", "Guardar"); g.type = "button";
    g.onclick = async () => { if (subiendo) return; g.disabled = true; try { const { error } = await supabase.rpc("mi_perfil_guardar", { p_bio: bio.value, p_fondo: sel, p_titulo: tit ? tit.value : null, p_portada: portada }); if (error) throw error; mostrarAviso("Perfil guardado ✔", "exito"); abrirPerfil(p.id); } catch (e) { mostrarAviso(msgErr(e, "No se pudo guardar."), "error"); g.disabled = false; } };
    const c = el("button", "pf-sec", "Cancelar"); c.type = "button"; c.onclick = () => pintarPerfil(p, false);
    ac.appendChild(g); ac.appendChild(c);
  }
  window.abrirPerfil = abrirPerfil; window.abrirMiPerfil = () => { if (!usuarioActual) { mostrarAviso("Ingresá con Google para ver tu perfil.", "info"); try { window.loginConGoogle(); } catch (_) {} return; } abrirPerfil(usuarioActual.id); };

  // ------------------- BIENVENIDA (una sola vez por cuenta) -------------------
  function bienvenida() {
    if (!usuarioActual) return;
    const k = "zarela_bienv_" + usuarioActual.id;
    try { if (localStorage.getItem(k)) return; } catch (_) {}
    const m = E("bv-modal"); if (!m || !m.hidden) return;
    if (document.body.classList.contains("tour-on") || document.body.classList.contains("modo-admin")) return;
    m.hidden = false;
    const fin = () => { m.hidden = true; try { localStorage.setItem(k, "1"); } catch (_) {} };
    E("bv-ok").onclick = fin; E("bv-x").onclick = fin; m.onclick = (e) => { if (e.target === m) fin(); };
  }

  // ------------------- LINK / ID DE AMIGO -------------------
  const miNum = () => (E("am-miid") ? E("am-miid").textContent.replace(/[^0-9]/g, "") : "");
  const linkAmigo = () => location.origin + "/?amigo=" + miNum();
  function pendienteAmigo() {
    if (!usuarioActual) return;
    let n = null; try { n = localStorage.getItem("zarela_amigo_pend"); } catch (_) {}
    if (!n || !window.abrirAmigos) return;
    try { localStorage.removeItem("zarela_amigo_pend"); } catch (_) {}
    setTimeout(() => window.abrirAmigos("#" + n), 1200);
  }
  function leerParam() {
    try { const u = new URL(location.href), n = (u.searchParams.get("amigo") || "").replace(/[^0-9]/g, ""); if (n) { localStorage.setItem("zarela_amigo_pend", n); u.searchParams.delete("amigo"); history.replaceState(null, "", u.pathname + (u.search || "") + u.hash); } } catch (_) {}
  }
  leerParam();

  function iniciar() {
    E("pf-modal")?.addEventListener("click", (e) => { if (e.target.id === "pf-modal") cerrar(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") cerrar(); });
    E("sb-miperfil")?.addEventListener("click", () => { try { if ($("sidebar-menu")?.classList.contains("open")) toggleMenu(); } catch (_) {} setTimeout(window.abrirMiPerfil, 200); });
    E("am-copiar")?.addEventListener("click", async () => { try { await navigator.clipboard.writeText("#" + miNum()); mostrarAviso("ID copiado 📋", "exito"); } catch (_) { mostrarAviso("Tu ID es #" + miNum(), "info"); } });
    E("am-compartir")?.addEventListener("click", async () => {
      const txt = "Sumate a Recargas Zarela y agregame de amigo 💎 Mi ID es #" + miNum() + ". Entrá acá:"; const url = linkAmigo();
      try { if (navigator.share) { await navigator.share({ title: "Recargas Zarela", text: txt, url }); return; } } catch (e) { if (e && e.name === "AbortError") return; }
      try { await navigator.clipboard.writeText(txt + " " + url); mostrarAviso("Link copiado: pegalo donde quieras 📲", "exito"); } catch (_) { mostrarAviso(url, "info"); }
    });
    setTimeout(() => { bienvenida(); pendienteAmigo(); cargarPublicos([yo()], true); }, 2500);
  }
  supabase.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_IN") setTimeout(() => { bienvenida(); pendienteAmigo(); }, 3000); });
  document.addEventListener("DOMContentLoaded", iniciar);
})();


// ===== v60 · Botón "atrás" del celular: cierra de a una capa (chat, panel, ventana) sin salirse de la página =====
(function atrasMod() {
  const E = (i) => document.getElementById(i);
  const mov = () => !matchMedia("(min-width: 801px)").matches;
  const mod = (sel, cerrar) => [() => { const n = document.querySelector(sel); return n && !n.hidden && getComputedStyle(n).display !== "none" ? n : null; }, cerrar];
  const pan = (sel, cerrar) => [() => { const n = document.querySelector(sel); return mov() && n && n.classList.contains("abierto") ? n : null; }, cerrar];
  const clic = (id) => () => E(id)?.click();
  // de la capa más "de arriba" a la más "de abajo"
  const CAPAS = [
    [() => document.querySelector(".adm-zoom"), (n) => n.remove()],
    mod("#dm-zoom", (n) => n.click()), mod("#al-modal", clic("al-x")), mod("#pf-modal", () => document.querySelector("#pf-card .pf-x, #pf-card .pf-volver")?.click()),
    mod("#am-modal", clic("am-x")), mod("#pr-modal", clic("pr-x")), mod("#hc-modal", clic("hc-x")), mod("#ha-modal", clic("ha-x")),
    mod("#hs-visor", clic("hs-x")), mod("#hs-panel", clic("hsp-x")), mod("#bv-modal", clic("bv-x")), mod("#nv-ayuda", (n) => { n.hidden = true; }),
    mod("#modal-compra", () => cerrarCompra()), mod("#modal-seleccion-carga", () => mostrarModal("modal-seleccion-carga", false)), mod("#modal-binance", () => mostrarModal("modal-binance", false)),
    mod("#modal-mercadopago", () => mostrarModal("modal-mercadopago", false)), mod("#modal-convertir", () => mostrarModal("modal-convertir", false)),
    mod("#salud-modal", (n) => { n.hidden = true; }), mod("#nh-modal", (n) => { n.hidden = true; }), mod("#av-modal", (n) => { n.hidden = true; }), mod("#pd-modal", (n) => { n.hidden = true; }),
    mod("#dm-ids", (n) => { n.hidden = true; }), mod("#op-inv", (n) => { n.hidden = true; }),
    [() => { const n = document.getElementById("sidebar-menu"); return n && n.classList.contains("open") ? n : null; }, () => toggleMenu()],
    [() => { const n = document.getElementById("hist-panel"); return n && !n.hidden ? n : null; }, () => alternarHistorial(false)],
    pan("#dm-panel", clic("dm-back")), pan("#cm-panel", clic("cm-x")), pan("#hub-panel", clic("hub-x")),
  ];
  function capaAbierta() {
    for (const [test, cerrar] of CAPAS) { const n = test(); if (n) return { n, cerrar }; }
    return null;
  }
  let puesto = false, propio = false, t = 0;
  function revisar() {
    clearTimeout(t); t = setTimeout(() => {
      const c = capaAbierta();
      if (c && !puesto) { try { history.pushState({ zcapa: 1 }, ""); puesto = true; } catch (_) {} }
      else if (!c && puesto) { puesto = false; propio = true; try { history.back(); } catch (_) { propio = false; } }
    }, 60);
  }
  window.addEventListener("popstate", () => {
    if (propio) { propio = false; return; }
    if (!puesto) return;
    puesto = false;
    const c = capaAbierta(); if (c) { try { c.cerrar(c.n); } catch (_) {} }
    setTimeout(() => { if (capaAbierta()) { try { history.pushState({ zcapa: 1 }, ""); puesto = true; } catch (_) {} } }, 120);
  });
  document.addEventListener("DOMContentLoaded", () => {
    new MutationObserver(revisar).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden", "class"] });
  });
})();


// ===== Panel de administrador: se puede mover y achicar/agrandar (PC) =====
(function () {
  const KEY = "zarela_admpanel";
  function iniciar() {
    const p = document.getElementById("admin-panel-section"), top = p && p.querySelector(".adm-top"); if (!p || !top || p.dataset.mov) return; p.dataset.mov = "1";
    const asa = document.createElement("i"); asa.className = "adm-asa"; asa.title = "Arrastrá para cambiar el tamaño"; p.appendChild(asa);
    const pc = () => matchMedia("(min-width: 801px)").matches;
    let g = {}; try { g = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (_) {}
    const aplicar = () => {
      if (!pc()) { p.style.transform = ""; p.style.width = ""; p.style.height = ""; return; }
      p.style.transform = "translate(" + (g.x || 0) + "px," + (g.y || 0) + "px)";
      p.style.width = g.w ? g.w + "px" : ""; p.style.height = g.h ? g.h + "px" : ""; p.style.maxWidth = g.w ? "none" : "";
      p.style.overflow = g.h ? "auto" : "";
    };
    const guardar = () => { try { localStorage.setItem(KEY, JSON.stringify(g)); } catch (_) {} };
    aplicar(); window.addEventListener("resize", aplicar);
    let d = null;
    top.addEventListener("pointerdown", (e) => { if (!pc() || e.target.closest("button,select,label,input,a")) return; d = { x: e.clientX, y: e.clientY, gx: g.x || 0, gy: g.y || 0 }; try { top.setPointerCapture(e.pointerId); } catch (_) {} });
    top.addEventListener("pointermove", (e) => { if (!d) return; g.x = d.gx + e.clientX - d.x; g.y = d.gy + e.clientY - d.y; aplicar(); });
    ["pointerup", "pointercancel"].forEach((n) => top.addEventListener(n, () => { if (d) { d = null; guardar(); } }));
    top.addEventListener("dblclick", (e) => { if (e.target.closest("button,select,label,input,a")) return; g = {}; aplicar(); guardar(); });
    top.style.cursor = "grab"; top.title = "Arrastrá para mover el panel (doble clic = lugar original)";
    let r = null;
    asa.addEventListener("pointerdown", (e) => { const b = p.getBoundingClientRect(); r = { x: e.clientX, y: e.clientY, w: b.width, h: b.height }; try { asa.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); });
    asa.addEventListener("pointermove", (e) => { if (!r) return; g.w = Math.max(560, Math.round(r.w + e.clientX - r.x)); g.h = Math.max(380, Math.round(r.h + e.clientY - r.y)); aplicar(); });
    asa.addEventListener("pointerup", () => { if (r) { r = null; guardar(); } });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
