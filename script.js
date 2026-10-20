// Variable global para almacenar el usuario activo
let usuarioActualUUID = "663cc991-70d8-4ee2-a7f5-d9a56d13484f"; // UUID de Julian JP por defecto

// Detectar sesión de Supabase si existe
if (window.supabase) {
  window.supabase.auth.getSession().then(({ data: { session } }) => {
    if (session && session.user) {
      usuarioActualUUID = session.user.id;
    }
  });
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
async function LoginConGoogle() {
  const { data, error } = await window.supabase.auth.signInWithOAuth({
    provider: 'google',
  });
  if (error) {
    console.error('Error al iniciar sesión con Google:', error.message);
  }
}
async function buscarJugador() {
  const inputID = document.getElementById('tu-id-del-input').value; // Asegurate de que el ID coincida con el de tu HTML
  
  if (!inputID) return alert("Por favor, ingresá un ID.");

  const { data, error } = await window.supabase
    .from('jugadores') // Nombre de tu tabla en Supabase
    .select('*')
    .eq('id_jugador', inputID) // Columna y valor a buscar
    .single();

  if (error || !data) {
    alert("Jugador no encontrado.");
  } else {
    // Ejemplo para mostrar el nombre del jugador en tu interfaz
    document.getElementById('elemento-para-mostrar-resultado').textContent = data.nombre;
  }
}
async function buscarJugador() {
  const inputID = document.getElementById('id_jugador').value;
  
  if (!inputID) return alert("Por favor, ingresá un ID.");

  try {
    const response = await fetch('https://almazarela.app.n8n.cloud/webhook/14200234-eee8-4b90-a4a3-1306b12c377f', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ id_jugador: inputID })
    });

    if (!response.ok) throw new Error('Error en la respuesta del servidor');

    const data = await response.json();
    
    // Asumiendo que el webhook devuelve el nombre del jugador en data.nombre
    if (data && data.nombre) {
      document.querySelector('.player-name').textContent = data.nombre;
      document.getElementById('player-card').classList.remove('hidden');
    } else {
      alert("Jugador no encontrado.");
    }
  } catch (error) {
    console.error('Error:', error);
    alert("Hubo un problema al buscar el jugador.");
  }
}