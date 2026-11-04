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
let slideActual = 3;
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
  if (previo) { pintarJugador({ nombre: previo, avatar: "", banner: "", nivel: null, region: "" }, id, true); jugadorVerificado = { id, nombre: previo, validado: false }; }

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
  opCargadas = true;
  renderOpiniones();
}
function esAdminActual() { return !!usuarioActual && (usuarioActual.email || "").toLowerCase() === CONFIG.ADMIN_EMAIL.toLowerCase(); }

let opBusca = "";
function renderOpiniones() {
  const lista = $("comments-list");
  if (!lista) return;
  const mia = usuarioActual ? opiniones.find((o) => o.user_id === usuarioActual.id) : null;

  $("op-form-login").hidden = !!usuarioActual;
  $("op-form-campos").hidden = !usuarioActual || (!!mia && !opEditando);
  if ($("op-form")) $("op-form").hidden = !!usuarioActual && !!mia && !opEditando;
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

function renderListaClientes() {
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
const TODAS_VISTAS = ["hoy", ...VISTAS_CHAT, "ordenes", "stock", "todas", "jugadores", ...VISTAS_COBRO];
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
  mostrar("admin-vista-salas", vista === "todas"); mostrar("admin-vista-jugadores", vista === "jugadores"); mostrar("admin-vista-cobro", esCobro);
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
}

// ---- Celular: el chat del cliente se abre a pantalla completa (como WhatsApp) y "atrás" vuelve a la lista ----
const esMovil = () => window.matchMedia("(max-width: 800px)").matches;
function abrirChatMovilAdmin() {
  if (!esMovil()) return;
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
  try {
    const r = await postWebhook({ ping: true }, 5000);
    return r.ok || r.status < 500;
  } catch (_) { return false; }
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
      if (r.es_soporte) { const b = document.createElement("span"); b.className = "op-badge"; b.textContent = "Soporte"; n.appendChild(b); }
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
const COBRO_DEF = { alias_mp: "almazarela.com", cvu_mp: "0000003100098290851840", titular_mp: "Julian Pereyra", binance_id: "1252553144", tasa_ars_usd: "1700", nivel_1: "110", nivel_2: "1000", nivel_3: "3000", nivel_4: "7000", nivel_5: "15000", binance_min: "1000" };
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
    const nv = [1, 2, 3, 4, 5].map((i) => Number($("cobro-nivel_" + i)?.value));
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
  { n: "Diamante", ico: "💎", k: "nivel_4" }, { n: "Leyenda", ico: "👑", k: "nivel_5" },
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
// banner sutil que va desde la foto hasta el final del nombre
function conBanner(nodoNombre, uid, conEtiqueta = true) {
  const i = nivelDeUsuario(uid);
  if (i < 0) return nodoNombre;
  const w = document.createElement("span"); w.className = "nvb nvb-" + i; w.title = "Nivel " + NIVELES[i].n;
  w.appendChild(nodoNombre);
  const ic = document.createElement("span"); ic.className = "nvb-ico"; ic.textContent = NIVELES[i].ico; w.appendChild(ic);
  if (conEtiqueta) { const t = document.createElement("span"); t.className = "nvb-t"; t.textContent = NIVELES[i].n; w.appendChild(t); }
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
  if (sbp) { sbp.classList.remove("nv-0", "nv-1", "nv-2", "nv-3", "nv-4"); if (i >= 0) sbp.classList.add("nv-" + i); }
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
  if (b) { b.classList.toggle("off", !act); b.querySelector("b").textContent = titulo; b.querySelector("small").textContent = sub; b.querySelector(".sb-ico").textContent = act ? "🔔" : perm === "denied" ? "🚫" : "🔕"; }
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
function pasaFiltroChats(uid) {
  const m = metaDe(uid);
  if (vistaChats === "archivados") return m.archivado;
  if (vistaChats.startsWith("sala")) return !m.archivado && m.salas.includes(Number(vistaChats.slice(4)));
  return !m.archivado;   // Chats: lo archivado desaparece; las salas NO lo sacan de acá
}
function textoVacioChats() {
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
  { id: "ninguno", n: "Oscuro", css: "linear-gradient(170deg,#0b0d18,#04050a)" },
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
  if (f?.tipo === "preset") css = (FONDOS_CHAT.find((x) => x.id === f.id) || {}).css || "";
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
  try {
    const { data, error } = await conTimeout(supabase.rpc("admin_stock_pines"), 12000);
    if (error) throw error;
    // Solo los paquetes que de verdad se venden con stock (los mismos que muestra la pestaña Stock); el resto no cuenta
    const reales = (data || []).filter((x) => ETIQUETA_STOCK[x.paquete_id]);
    const lista = reales.length ? reales : (data || []);
    const nom = (x) => (ETIQUETA_STOCK[x.paquete_id] ? ETIQUETA_STOCK[x.paquete_id] + " 💎" : x.nombre || x.diamantes + " 💎");
    const sin = lista.filter((x) => Number(x.disponibles) === 0), pocos = lista.filter((x) => Number(x.disponibles) > 0 && Number(x.disponibles) < 5);
    if (sin.length) out.push({ id: "stock-cero", nivel: "alto", icono: "📉", titulo: `Sin PINs para: ${sin.map(nom).join(", ")}`,
      detalle: "Si un cliente compra ese paquete, no hay PIN para entregarle.",
      pasos: ["Comprá PINs en tu proveedor para esos paquetes.", "En el panel andá a Stock, elegí el paquete y pegá los códigos (uno por línea) con «Agregar PINs».", "Cuando haya stock vuelve a quedar todo en verde."],
      ir: irPanelAdmin("stock"), irTxt: "Ir a Stock" });
    if (pocos.length) out.push({ id: "stock-poco", nivel: "bajo", icono: "📉", titulo: `Quedan muy pocos PINs: ${pocos.map((x) => nom(x) + " (" + x.disponibles + ")").join(", ")}`,
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
  const n = saludProblemas.filter((p) => p.nivel !== "bajo").length, total = saludProblemas.length;
  b.classList.toggle("mal", n > 0); b.classList.toggle("aviso", n === 0 && total > 0); b.classList.toggle("bien", total === 0);
  b.querySelector("em").textContent = n ? String(n) : total ? "!" : "✓";
  b.title = n ? `${n} cosa${n > 1 ? "s" : ""} para revisar` : total ? "Avisos menores" : "Todo en orden";
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
    d.stock = stockPaquetes.filter((p) => ETIQUETA_STOCK[p.paquete_id] && (Number(p.disponibles) || 0) < 5).map((p) => ({ nombre: ETIQUETA_STOCK[p.paquete_id], n: Number(p.disponibles) || 0 }));
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
let cliDatos = null, cliTs = 0, cliCargando = false, cliTab = "hoy", cliQ = "", cliN = 6;
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
function tarjetaClientes(abrirChat) {
  const t = document.createElement("div"); t.className = "hoy-card info cli-card";
  const pintar = () => {
    const d = cliDatos; if (!d) return;
    const hoyN = d.hoy, totN = d.total;
    t.innerHTML = `<div class="hoy-cab"><span>👥</span><b>Clientes</b></div>
      <div class="cli-tabs"><button type="button" data-t="hoy" class="${cliTab === "hoy" ? "on" : ""}"><strong>${hoyN}</strong><small>Registrados hoy</small></button><button type="button" data-t="total" class="${cliTab === "total" ? "on" : ""}"><strong>${totN}</strong><small>Total de clientes</small></button></div>
      <label class="cli-bus">🔍<input type="search" class="cli-q" placeholder="Buscar por nombre o mail" autocomplete="off"></label><div class="cli-lista"></div>`;
    const q = t.querySelector(".cli-q"); q.value = cliQ;
    const lista = t.querySelector(".cli-lista");
    const llenar = () => {
      lista.replaceChildren();
      const bus = cliQ.trim().toLowerCase();
      let filas = d.filas.filter((f) => cliTab === "total" || new Date(f.created_at).getTime() >= d.ini);
      if (bus) filas = filas.filter((f) => ((f.full_name || "") + " " + (f.email || "")).toLowerCase().includes(bus));
      if (d.error) { const p = document.createElement("p"); p.className = "hoy-vacio"; p.textContent = "No se pudo leer la lista de clientes."; lista.appendChild(p); return; }
      if (!filas.length) { const p = document.createElement("p"); p.className = "hoy-vacio"; p.textContent = bus ? "Nadie coincide con esa búsqueda." : cliTab === "hoy" ? "Hoy todavía no se registró nadie." : "Sin clientes."; lista.appendChild(p); return; }
      filas.slice(0, cliN).forEach((f) => {
        const b = document.createElement("button"); b.type = "button"; b.className = "cli-fila";
        const nom = f.full_name || (f.email || "").split("@")[0] || "Cliente";
        const av = document.createElement("span"); av.className = "cli-av"; pintarAvatarEn(av, f.avatar_url, (nom[0] || "C").toUpperCase());
        const tx = document.createElement("span"); tx.className = "cli-tx"; tx.innerHTML = "<b></b><small></small>"; tx.firstChild.textContent = nom; tx.lastChild.textContent = f.email || "";
        const fe = document.createElement("em"); const ms = new Date(f.created_at).getTime(); fe.textContent = ms >= d.ini ? new Date(ms).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : new Date(ms).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
        b.append(av, tx, fe); b.title = "Abrir chat"; b.addEventListener("click", () => abrirChat(f.id)); lista.appendChild(b);
      });
      if (filas.length > cliN) { const m = document.createElement("button"); m.type = "button"; m.className = "cli-mas"; m.textContent = `Ver más (${filas.length - cliN})`; m.addEventListener("click", () => { cliN += 10; llenar(); }); lista.appendChild(m); }
      else if (cliN > 6) { const m = document.createElement("button"); m.type = "button"; m.className = "cli-mas"; m.textContent = "Ver menos"; m.addEventListener("click", () => { cliN = 6; llenar(); }); lista.appendChild(m); }
    };
    llenar();
    t.querySelectorAll(".cli-tabs button").forEach((b) => b.addEventListener("click", () => { cliTab = b.dataset.t; cliN = 6; pintar(); }));
    q.addEventListener("input", () => { cliQ = q.value; cliN = 6; llenar(); });
  };
  if (cliDatos) pintar(); else t.innerHTML = '<div class="hoy-cab"><span>👥</span><b>Clientes</b></div><p class="hoy-vacio">Cargando…</p>';
  if (!cliDatos || Date.now() - cliTs > 60000) cliCargar().then(() => { if (t.isConnected && document.activeElement !== t.querySelector(".cli-q")) pintar(); });
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
async function pintarHoy() {
  const c = $("hoy-cont"); if (!c) return;
  const mi = ++hoySeq;
  const d = await hoyDatos(); if (mi !== hoySeq || vistaAdmin !== "hoy") return;
  const b = $("hoy-n"); if (b) { const n = hoyTotal(d); b.hidden = n === 0; b.textContent = String(n); }
  if (document.activeElement && document.activeElement.classList && (document.activeElement.classList.contains("hoy-seg-in") || document.activeElement.classList.contains("hoy-aus-in") || document.activeElement.classList.contains("cli-q") || document.activeElement.classList.contains("rp-in"))) return;   // no te saco del casillero mientras escribís
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
    ? `ESTÁS DISPONIBLE: cada pedido nuevo espera hasta ${fmtSeg(d.segundos)} acá (cada uno con su propio reloj). Si lo comprás vos con descuento, apretá «Ya la cargué». Si no hacés nada, sale solo con tu PIN. Si apagás o salís de Pendientes, lo que esté esperando sale con PIN al instante. La primera compra de cada ID sale siempre con PIN. Desde la segunda te llega acá, salvo ese paquete que ya resolviste («Ya la cargué», o PIN dos veces).`
    : "Apagado: todos los pedidos salen al instante con tus PIN. Prendelo cuando estés frente a la compu y quieras aprovechar el 50 %.";
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
      f.querySelector(".hoy-pin").addEventListener("click", async () => { const { error } = await supabase.rpc("admin_promo_mandar_pin", { p_orden_id: o.id }); if (!error) promoMarcarId(o.id_jugador, o.diamantes, "pin"); mostrarAviso(error ? "No se pudo enviar." : "Enviada con PIN.", error ? "error" : "ok"); pintarHoy(); });
      w.appendChild(f);
    });
    c.appendChild(w);
  }
  const grid = document.createElement("div"); grid.className = "hoy-grid";
  grid.append(
    tarjeta("💬", "Chats sin leer", d.chats.length, "aviso", d.chats.map((x) => [etiquetaCliente(x.id), `${x.n} sin leer · ${tiempoRelativo(x.ultima)}`, () => abrirChat(x.id)]), "No hay mensajes sin leer.", ["Ir a Chats", () => mostrarVistaAdmin("clientes")]),
    tarjeta("🧾", "Órdenes por atender", d.ords.length, "alto", d.ords.map((o) => [`#${o.id} · ${o.diamantes || "?"} 💎 · ID ${o.id_jugador || "-"}`, (/REVISAR A MANO/i.test(o.envio_error || "") ? "⚠ revisar a mano · " : o.estado === "error_envio" ? "no llegó a n8n · " : "") + minOrd(o), () => mostrarVistaAdmin("ordenes")]), "Todas las órdenes están al día.", ["Ir a Órdenes", () => mostrarVistaAdmin("ordenes")]),
    tarjeta("📦", "Stock de PIN bajo", d.stock.length, "aviso", d.stock.map((p) => [`Paquete ${p.nombre} 💎`, p.n === 0 ? "sin PIN" : `quedan ${p.n}`, () => mostrarVistaAdmin("stock")]), "Hay PIN suficientes en todos los paquetes.", ["Ir a Stock", () => mostrarVistaAdmin("stock")]),
  );
  grid.append(tarjetaClientes(abrirChat), tarjetaReglasPerfil());
  const hoy = document.createElement("div"); hoy.className = "hoy-card info";
  hoy.innerHTML = `<div class="hoy-cab"><span>📈</span><b>Hoy</b></div><p class="hoy-num"></p><small class="hoy-mas">Contado sobre tus últimas 60 órdenes.</small><button type="button" class="hoy-ir">🩺 Revisar errores y cómo arreglarlos</button>`;
  hoy.querySelector(".hoy-num").textContent = `${d.hoyOk} recarga${d.hoyOk === 1 ? "" : "s"} acreditada${d.hoyOk === 1 ? "" : "s"} · ${fmtNum(d.hoyDia)} 💎`;
  hoy.querySelector(".hoy-ir").addEventListener("click", () => { try { abrirSalud(); } catch (_) {} });
  grid.appendChild(hoy);
  c.appendChild(grid);
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
const SOPORTE_TXT = { en_linea: "En línea · Soporte", desconectada: "Desconectada · Soporte", oculto: "" };
function pintarSoporte(base) {
  if (!Object.prototype.hasOwnProperty.call(SOPORTE_TXT, base)) base = "en_linea";
  soporteBase = base;
  const e = (servidorLento && base !== "oculto") ? "desconectada" : base;   // recargas demoradas (compu apagada): se ve "Desconectada" sola
  soporteEstado = e;
  if (e === "en_linea") { try { $("chat-aviso-off")?.remove(); } catch (_) {} }
  const w = $("chat-widget"); if (w) w.dataset.soporte = e;
  const t = $("chat-soporte-txt"); if (t) { t.textContent = SOPORTE_TXT[e]; t.hidden = e === "oculto"; }
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
let sfxCtx = null, sfxUlt = 0;
const sfxActivo = () => { try { return localStorage.getItem("zarela_sfx") !== "0"; } catch (_) { return true; } };
function sfxTono(c, t0, f1, f2, dur, vol, tipo = "sine") {
  const o = c.createOscillator(), g = c.createGain();
  o.type = tipo; o.frequency.setValueAtTime(f1, t0); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.02);
}
function sfx(nombre) {
  if (!sfxActivo()) return;
  const ahora = Date.now(); if (nombre === "tap" && ahora - sfxUlt < 70) return; sfxUlt = ahora;   // el toque nunca pisa a otro sonido
  try {
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    sfxCtx = sfxCtx || new C(); if (sfxCtx.state === "suspended") sfxCtx.resume();
    const c = sfxCtx, t = c.currentTime + 0.005;
    if (nombre === "abrir") { sfxTono(c, t, 440, 660, 0.12, 0.05); sfxTono(c, t + 0.07, 660, 880, 0.14, 0.04); }
    else if (nombre === "cerrar") { sfxTono(c, t, 660, 400, 0.12, 0.045); }
    else if (nombre === "ok") { sfxTono(c, t, 523, null, 0.1, 0.05); sfxTono(c, t + 0.08, 659, null, 0.1, 0.05); sfxTono(c, t + 0.16, 784, null, 0.18, 0.05); }
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
  if (ico) ico.textContent = on ? "🔊" : "🔇"; if (sm) sm.textContent = on ? "Activados" : "Silenciados";
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
    mostrarAviso("¡Listo! Ahora te ven como «" + v + "» en el Top.", "ok");
    cerrarAlias();
  } catch (_) { nota.textContent = "No pudimos guardarlo. Revisá tu conexión."; ok.disabled = false; }
}
document.addEventListener("DOMContentLoaded", () => { $("al-x")?.addEventListener("click", cerrarAlias); $("al-modal")?.addEventListener("click", (e) => { if (e.target.id === "al-modal") cerrarAlias(); }); $("al-in")?.addEventListener("input", aliasPrevia); $("al-in")?.addEventListener("keydown", (e) => { if (e.key === "Enter") guardarAlias(); }); $("al-ok")?.addEventListener("click", guardarAlias); });
Object.assign(window, { abrirAlias });


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
function aplicarFotoPropia(url) {
  const ini = (nombreCompleto(usuarioActual)[0] || "A").toUpperCase();
  pintarAvatarEn($("sb-avatar"), url, ini); pintarAvatarEn($("cu-av"), url, ini); aliasFotoPintar(url);
}
async function cargarFotoPropia() {   // si ya subió una foto propia, se usa en vez de la de Google
  if (!usuarioActual) return;
  try {
    const { data } = await conTimeout(supabase.from(CONFIG.TABLA_PERFILES).select("avatar_url").eq(CONFIG.COL_ID, usuarioActual.id).maybeSingle(), 8000);
    if (data && esFotoPropia(data.avatar_url)) aplicarFotoPropia(data.avatar_url);
  } catch (_) {}
}
setInterval(() => { if (usuarioActual && !usuarioActual._fotoOk) { usuarioActual._fotoOk = true; cargarFotoPropia(); } }, 3000);
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
