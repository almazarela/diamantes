// Configuración de Supabase y Clave Pública
const SUPABASE_URL = "https://egtuaihydqmaqehavgrnd.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_fEVgUFX5bTcoMCqjsT44-A_tgW4pVeZ";

let supabaseClient = null;
let usuarioActualUUID = null;
let adminSelectedUser = null;
let unsubscribeAdminChat = null;

if (window.supabase) {
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  
  supabaseClient.auth.getSession().then(({ data: { session } }) => {
    if (session && session.user) {
      usuarioActualUUID = session.user.id;
      verificarSiEsAdmin(session.user);
    }
  });

  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (session && session.user) {
      usuarioActualUUID = session.user.id;
      verificarSiEsAdmin(session.user);
    } else {
      usuarioActualUUID = null;
      if (unsubscribeAdminChat) unsubscribeAdminChat();
    }
  });
}

// Verificar si el usuario conectado es el administrador
function verificarSiEsAdmin(user) {
  if (user.email === 'almita.zarela@gmail.com') {
    cargarListaClientesAdmin();
    escucharMensajesEnTiempoRealCliente();
  } else {
    escucharMensajesEnTiempoRealCliente();
  }
}

// Escuchar mensajes en tiempo real para usuarios comunes
document.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => {
    escucharMensajesEnTiempoRealCliente();
  }, 1000);
});

function escucharMensajesEnTiempoRealCliente() {
  if (!supabaseClient || !usuarioActualUUID) return;

  supabaseClient
    .channel('mensajes-live-client')
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
        if (nuevoMensaje.sender_id !== usuarioActualUUID) {
          mostrarMensajeEnChat(nuevoMensaje.content, 'admin-msg');
        }
      }
    )
    .subscribe();
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

// ==========================================
// FUNCIONES DEL PANEL DE ADMINISTRADOR
// ==========================================

function cargarListaClientesAdmin() {
  if (!supabaseClient) return;

  // Consultar perfiles o usuarios únicos que han enviado mensajes
  supabaseClient
    .from('profiles')
    .select('*')
    .then(({ data, error }) => {
      const container = document.getElementById('admin-users-list');
      if (!container) return;
      
      if (error || !data || data.length === 0) {
        container.innerHTML = '<p style="font-size: 12px; color: #94a3b8; padding: 12px; text-align: center;">No hay clientes todavía.</p>';
        return;
      }

      container.innerHTML = '';
      data.forEach((u) => {
        const div = document.createElement('div');
        div.style.padding = '12px';
        div.style.borderBottom = '1px solid #334155';
        div.style.cursor = 'pointer';
        div.style.transition = 'background 0.2s';
        
        div.onmouseover = () => div.style.background = '#334155';
        div.onmouseout = () => div.style.background = 'transparent';
        
        div.innerHTML = `
          <div style="font-weight: bold; color: #f8fafc; font-size: 13px;">${u.email || 'Cliente ID: ' + u.id.slice(0,6)}</div>
          <div style="font-size: 11px; color: #38bdf8; margin-top: 2px;">Ver chat y gestionar</div>
        `;
        
        div.onclick = () => abrirChatAdmin(u.id, u.email || 'Cliente');
        container.appendChild(div);
      });
    });
}

function abrirChatAdmin(uid, emailCliente) {
  adminSelectedUser = uid;
  const header = document.getElementById('admin-chat-header');
  if (header) {
    header.innerHTML = `Chat activo con: <b>${emailCliente}</b>`;
  }

  if (unsubscribeAdminChat) {
    supabaseClient.removeChannel(unsubscribeAdminChat);
  }

  // Cargar historial de mensajes del usuario seleccionado
  supabaseClient
    .from('messages')
    .select('*')
    .eq('user_id', uid)
    .order('created_at', { ascending: true })
    .then(({ data }) => {
      renderizarMensajesAdmin(data || []);
    });

  // Suscribirse en tiempo real a los mensajes de este cliente específico
  unsubscribeAdminChat = supabaseClient
    .channel(`admin-chat-${uid}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `user_id=eq.${uid}`
      },
      (payload) => {
        const view = document.getElementById('admin-chat-view');
        if (!view) return;
        const m = payload.new;
        const esAdmin = m.sender_id !== uid;

        const bubble = document.createElement('div');
        bubble.style.maxWidth = '75%';
        bubble.style.padding = '10px 14px';
        bubble.style.borderRadius = '12px';
        bubble.style.fontSize = '13px';
        bubble.style.wordBreak = 'break-word';
        bubble.style.alignSelf = esAdmin ? 'flex-end' : 'flex-start';
        bubble.style.background = esAdmin ? '#0284c7' : '#334155';
        bubble.style.color = '#fff';
        bubble.textContent = m.content;
        view.appendChild(bubble);
        view.scrollTop = view.scrollHeight;
      }
    )
    .subscribe();
}

function renderizarMensajesAdmin(mensajes) {
  const view = document.getElementById('admin-chat-view');
  if (!view) return;
  view.innerHTML = '';

  if (mensajes.length === 0) {
    view.innerHTML = '<p style="font-size: 13px; color: #64748b; text-align: center; margin: auto;">No hay mensajes en este chat.</p>';
    return;
  }

  mensajes.forEach((m) => {
    const esAdmin = m.sender_id !== adminSelectedUser;
    const bubble = document.createElement('div');
    bubble.style.maxWidth = '75%';
    bubble.style.padding = '10px 14px';
    bubble.style.borderRadius = '12px';
    bubble.style.fontSize = '13px';
    bubble.style.wordBreak = 'break-word';
    bubble.style.alignSelf = esAdmin ? 'flex-end' : 'flex-start';
    bubble.style.background = esAdmin ? '#0284c7' : '#334155';
    bubble.style.color = '#fff';
    bubble.textContent = m.content;
    view.appendChild(bubble);
  });
  view.scrollTop = view.scrollHeight;
}

// Enviar respuesta del administrador al usuario seleccionado
window.enviarRespuestaAdminActivo = async function() {
  const input = document.getElementById('admin-input-reply');
  const texto = input ? input.value.trim() : '';
  
  if (!texto || !adminSelectedUser || !supabaseClient) return;

  try {
    const { error } = await supabaseClient
      .from('messages')
      .insert([
        {
          content: texto,
          user_id: adminSelectedUser,
          sender_id: usuarioActualUUID // ID del admin para diferenciarlo
        }
      ]);

    if (error) {
      console.error("Error al enviar respuesta:", error);
      return;
    }

    if (input) input.value = '';
  } catch (e) {
    console.error("Error de red al responder:", e);
  }
};

// ==========================================
// FUNCIÓN PRINCIPAL DE ENVÍO DE CLIENTES (WEBHOOK N8N)
// ==========================================
async function enviarMensajeWebhook() {
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
      user_id: usuarioActualUUID || "9ea78e3d-c949-4c4d-a9d2-492d8567104b",
      text: textoMensaje,
      archivo: archivoBase64,
      nombre_archivo: nombreArchivo
    };

    const respuesta = await fetch(urlWebhook, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
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
}