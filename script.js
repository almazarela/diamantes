// Configuración de Supabase y Clave Pública
const SUPABASE_URL = "https://egtuaihydqmaqehavgrnd.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_fEVgUFX5bTcoMCqjsT44-A_tgW4pVeZ";

// Variable global para almacenar el usuario activo
let usuarioActualUUID = "9ea78e3d-c949-4c4d-a9d2-492d8567104b"; // UUID activo de Julian JP

// Inicializar cliente de Supabase
let supabaseClient = null;
if (window.supabase) {
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  
  // Detectar sesión de Supabase si existe
  supabaseClient.auth.getSession().then(({ data: { session } }) => {
    if (session && session.user) {
      usuarioActualUUID = session.user.id;
    }
  });
}

// Escuchar mensajes nuevos en tiempo real al cargar la página
document.addEventListener("DOMContentLoaded", () => {
  escucharMensajesEnTiempoReal();
});

function escucharMensajesEnTiempoReal() {
  if (!supabaseClient) return;

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
        // Si el mensaje viene del administrador, mostrarlo en pantalla automáticamente
        if (nuevoMensaje.sender_id !== usuarioActualUUID) {
          mostrarMensajeEnChat(nuevoMensaje.content, 'admin-msg');
        }
      }
    )
    .subscribe();
}

// Auxiliar para dibujar el mensaje en la pantalla
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

// Función principal para enviar mensajes al Webhook de n8n
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
      user_id: usuarioActualUUID,
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