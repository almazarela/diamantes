// Función para enviar mensajes y fotos al webhook de n8n (Modo Producción)
async function enviarMensajeWebhook() {
  const urlWebhook = 'https://almazarela.app.n8n.cloud/webhook/14200234-eee8-4b90-a4a3-1306b12c377f';

  // 1. Capturar el texto del input
  const inputMensaje = document.getElementById('chat-user-input'); 
  const textoMensaje = inputMensaje ? inputMensaje.value.trim() : '';

  // 2. Capturar el archivo (foto) si el usuario seleccionó uno
  const inputArchivo = document.getElementById('chat-file-input');
  const archivo = inputArchivo && inputArchivo.files[0] ? inputArchivo.files[0] : null;

  // Si no hay texto ni archivo, no hace nada
  if (!textoMensaje && !archivo) return;

  // Función para convertir la imagen a Base64 y enviarla en el JSON
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

    // 3. Estructura con el UUID real de Supabase para JULIAN JP
    const payload = {
      tipo_evento: "CHAT_MENSAJE",
      user_id: "663cc991-70d8-4ee2-a7f5-d9a56d13484f", // UUID válido de la cuenta JULIAN JP
      text: textoMensaje,
      archivo: archivoBase64,       
      nombre_archivo: nombreArchivo
    };

    // 4. Enviar mediante POST
    const respuesta = await fetch(urlWebhook, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (respuesta.ok) {
      console.log('✅ Mensaje enviado con éxito');
      
      // Mostrar el mensaje en la interfaz
      const area = document.getElementById('chat-messages-container');
      if (area && textoMensaje) {
        const div = document.createElement('div');
        div.className = 'chat-message user-msg';
        div.textContent = textoMensaje;
        area.appendChild(div);
        area.scrollTop = area.scrollHeight;
      }

      // Limpiar campos
      if (inputMensaje) inputMensaje.value = '';
      if (inputArchivo) inputArchivo.value = '';
    } else {
      console.error('❌ Error en el servidor:', respuesta.status);
    }
  } catch (error) {
    console.error('❌ Error de conexión:', error);
  }
}