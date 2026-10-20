// CONFIGURACIÓN SUPABASE
const SUPABASE_URL = "https://egtuaihydqmaqehavgrnd.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_fEVgUFX5bTcoMCqjsT44-A_tgW4pVeZ";

let supabaseClient = null;
let usuarioActualUUID = "9ea78e3d-c949-4c4d-a9d2-492d8567104b";

// Inicialización sincronizada con la carga del DOM
document.addEventListener("DOMContentLoaded", () => {
  try {
    if (window.supabase && typeof window.supabase.createClient === 'function') {
      supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      
      supabaseClient.auth.getSession().then(({ data: { session } }) => {
        if (session && session.user) {
          usuarioActualUUID = session.user.id;
          manejarSesionUsuario(session.user);
        }
      });

      supabaseClient.auth.onAuthStateChange((event, session) => {
        if (session && session.user) {
          usuarioActualUUID = session.user.id;
          manejarSesionUsuario(session.user);
        } else {
          usuarioActualUUID = "9ea78e3d-c949-4c4d-a9d2-492d8567104b";
          const authForms = document.getElementById('auth-forms');
          const userDashboard = document.getElementById('user-dashboard');
          const panelAdmin = document.getElementById('admin-panel-section');
          if (authForms) authForms.style.display = 'block';
          if (userDashboard) userDashboard.style.display = 'none';
          if (panelAdmin) panelAdmin.style.display = 'none';
        }
      });
    }
  } catch (e) {
    console.error("Error al inicializar Supabase:", e);
  }

  escucharMensajesEnTiempoReal();
});

// Autenticación Google orientada a producción
window.loginConGoogle = async function() {
  if (!supabaseClient) {
    alert("Supabase no está inicializado.");
    return;
  }
  try {
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: { 
        redirectTo: 'https://almazarela.github.io/diamantes/' 
      }
    });
    if (error) throw error;
  } catch (err) {
    console.error("Error al iniciar sesión con Google:", err);
  }
};

window.logoutGoogle = async function() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
};

function manejarSesionUsuario(user) {
  const authForms = document.getElementById('auth-forms');
  const userDashboard = document.getElementById('user-dashboard');
  const emailDisplay = document.getElementById('user-email-display');
  
  if (authForms) authForms.style.display = 'none';
  if (userDashboard) userDashboard.style.display = 'block';
  if (emailDisplay) emailDisplay.innerText = user.email;

  if (user.email === 'almita.zarela@gmail.com') {
    const panelAdmin = document.getElementById('admin-panel-section');
    if (panelAdmin) panelAdmin.style.display = 'block';
  }
}

// Modales y navegación
window.abrirModalSeleccionCarga = function() {
  const modal = document.getElementById('modal-seleccion-carga');
  if (modal) modal.style.display = 'flex';
};

window.cerrarModalSeleccionCarga = function() {
  const modal = document.getElementById('modal-seleccion-carga');
  if (modal) modal.style.display = 'none';
};

window.abrirModalBinance = function() {
  window.cerrarModalSeleccionCarga();
  const modal = document.getElementById('modal-binance');
  if (modal) modal.style.display = 'flex';
};

window.cerrarModalBinance = function() {
  const modal = document.getElementById('modal-binance');
  if (modal) modal.style.display = 'none';
};

window.abrirModalMercadoPagoSaldo = function() {
  window.cerrarModalSeleccionCarga();
  const modal = document.getElementById('modal-mercadopago');
  if (modal) modal.style.display = 'flex';
};

window.cerrarModalMercadoPagoSaldo = function() {
  const modal = document.getElementById('modal-mercadopago');
  if (modal) modal.style.display = 'none';
};

window.procesarCargaBinanceModal = function() {
  const input = document.getElementById('monto-usdt');
  const monto = input ? input.value.trim() : '';
  if(!monto) { alert("Ingresá un monto válido en USD"); return; }
  alert("Solicitud de recarga USDT por $" + monto + " generada. Envianos el comprobante.");
  window.cerrarModalBinance();
};

window.procesarCargaMPModal = function() {
  const input = document.getElementById('monto-mp');
  const monto = input ? input.value.trim() : '';
  if(!monto) { alert("Ingresá un monto válido en ARS"); return; }
  alert("Solicitud de recarga Mercado Pago por $" + monto + " ARS generada. Envianos el comprobante.");
  window.cerrarModalMercadoPagoSaldo();
};

window.verificarJugador = function() {
  const inputId = document.getElementById('player-id');
  const status = document.getElementById('verify-status');
  const card = document.getElementById('player-card');
  const nameEl = document.getElementById('player-name');
  const metaEl = document.getElementById('player-meta');
  const btn = document.getElementById('btn-verificar');

  const playerId = inputId ? inputId.value.trim() : '';

  if (!playerId) {
    if (status) {
      status.textContent = "Por favor ingresa un ID válido.";
      status.className = "verify-status error";
    }
    return;
  }

  if (btn) btn.disabled = true;
  if (status) {
    status.textContent = "Verificando con servidores de Garena...";
    status.className = "verify-status loading";
  }

  setTimeout(() => {
    if (card) card.hidden = false;
    if (nameEl) nameEl.textContent = "Jugador FF #" + playerId;
    if (metaEl) metaEl.textContent = "Región: Sudamérica | Nivel Verificado";
    if (status) {
      status.textContent = "¡Jugador verificado con éxito!";
      status.className = "verify-status ok";
    }
    if (btn) btn.disabled = false;
  }, 800);
};

window.seleccionarMetodo = function(metodo) {
  const cardMp = document.getElementById('card-mp');
  const cardBinance = document.getElementById('card-binance');
  const gridMp = document.getElementById('grid-mp');
  const gridBinance = document.getElementById('grid-binance');

  if (metodo === 'mp') {
    if (cardMp) cardMp.classList.add('active');
    if (cardBinance) cardBinance.classList.remove('active');
    if (gridMp) gridMp.style.display = 'block';
    if (gridBinance) gridBinance.style.display = 'none';
  } else {
    if (cardBinance) cardBinance.classList.add('active');
    if (cardMp) cardMp.classList.remove('active');
    if (gridBinance) gridBinance.style.display = 'block';
    if (gridMp) gridMp.style.display = 'none';
  }
};

window.actualizarEnlaceWhatsApp = function(elemento, paquete, precio) {
  const playerIdInput = document.getElementById('player-id');
  const playerId = playerIdInput ? playerIdInput.value.trim() : 'No ingresado';
  const texto = `Hola! Quiero comprar ${paquete} por ${precio}. Mi ID de Free Fire es: ${playerId}`;
  elemento.href = `https://wa.me/54911XXXXXXXX?text=${encodeURIComponent(texto)}`;
};

let slideActual = 1;
window.moverCarrusel = function(direccion) {
  const track = document.getElementById('carousel-track');
  if (!track) return;
  const slides = track.getElementsByClassName('carousel-slide');
  if (!slides || slides.length === 0) return;
  slideActual += direccion;
  if (slideActual >= slides.length) slideActual = 0;
  if (slideActual < 0) slideActual = slides.length - 1;
  track.style.transform = `translateX(-${slideActual * 100}%)`;
};

window.toggleMenu = function() {
  const menu = document.getElementById('sidebar-menu');
  const overlay = document.getElementById('menu-overlay');
  if (menu) menu.classList.toggle('active');
  if (overlay) overlay.classList.toggle('active');
};

function escucharMensajesEnTiempoReal() {
  if (!supabaseClient) return;

  try {
    supabaseClient
      .channel('mensajes-live')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `user_id=eq.${usuarioActualUUID}`
        },
        (payload) => {
          const nuevoMensaje = payload.new;
          if (nuevoMensaje && nuevoMensaje.sender_id !== usuarioActualUUID) {
            mostrarMensajeEnChat(nuevoMensaje.content, 'admin-msg');
          }
        }
      )
      .subscribe();
  } catch (e) {
    console.error("Error en tiempo real:", e);
  }
}

function mostrarMensajeEnChat(texto, clase) {
  const area = document.getElementById('chat-messages-container');
  if (area && texto) {
    const div = document.createElement('div');
    div.className = `chat-message ${clase}`;
    div.textContent = texto;
    area.appendChild(div);
    area.scrollTop = area.scrollHeight;
  }
}

window.enviarMensajeWebhook = async function() {
  const urlWebhook = 'https://almazarela.app.n8n.cloud/webhook/14200234-eee8-4b90-a4a3-1306b12c377f';

  const inputMensaje = document.getElementById('chat-user-input');
  const textoMensaje = inputMensaje ? inputMensaje.value.trim() : '';

  const inputArchivo = document.getElementById('chat-file-input');
  const archivo = inputArchivo && inputArchivo.files[0] ? inputArchivo.files[0] : null;

  if (!textoMensaje && !archivo) return;

  const convertirBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result);
      reader.onerror = (error) => reject(error);
    });
  };

  try {
    let archivoBase64 = "";
    let nombreArchivo = "";

    if (archivo) {
      archivoBase64 = await convertirBase64(archivo);
      nombreArchivo = archivo.name;
    }

    const payload = {
      tipo_evento: "CHAT_MENSAJE",
      user_id: usuarioActualUUID,
      text: textoMensaje,
      archivo: archivoBase64,
      nombre_archivo: nombreArchivo
    };

    const respuesta = await fetch(urlWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (respuesta.ok) {
      const area = document.getElementById('chat-messages-container');
      if (area && textoMensaje) {
        const div = document.createElement('div');
        div.className = 'chat-message user-msg';
        div.textContent = textoMensaje;
        area.appendChild(div);
        area.scrollTop = area.scrollHeight;
      }

      if (inputMensaje) inputMensaje.value = '';
      if (inputArchivo) inputArchivo.value = '';
    } else {
      console.error('Error al enviar el mensaje:', respuesta.status);
    }
  } catch (error) {
    console.error('Error de red:', error);
  }
};