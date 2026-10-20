// Función para enviar mensajes al webhook
async function enviarMensajeWebhook() {
  // 1. Obtener la URL de tu webhook de n8n
  const urlWebhook = 'https://almazarela.app.n8n.cloud/webhook-test/7a0834cd-9cd0-46dc-b670-19b6bb1061a3';

  // 2. Capturar el mensaje escrito por el usuario (ajusta el selector si tu input tiene un ID específico)
  const inputMensaje = document.querySelector('.chat-input'); 
  const textoMensaje = inputMensaje ? inputMensaje.value : 'Mensaje de prueba';

  // 3. Armar la estructura del objeto JSON
  const payload = {
    tipo_evento: "CHAT_MENSAJE",
    usuario_id: "333556673", // Puedes usar el ID que se verificó en tu pantalla
    mensaje: textoMensaje,
    archivo_url: "" 
  };

  try {
    // 4. Enviar los datos mediante POST
    const respuesta = await fetch(urlWebhook, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (respuesta.ok) {
      console.log('✅ Mensaje enviado al webhook con éxito');
      if (inputMensaje) inputMensaje.value = ''; // Limpia el input
    } else {
      console.error('❌ Error en la respuesta del webhook:', respuesta.status);
    }
  } catch (error) {
    console.error('❌ Error de conexión al enviar al webhook:', error);
  }
}