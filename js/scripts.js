import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://egtuaihydqkmaqehgrnd.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_fEVgUFX5bTcoMCqjsT44-A_tgW4pVeZ";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    detectSessionInUrl: true,
    flowType: "pkce",
  },
});

window.supabase = supabase;

const WEBHOOK_INICIO_SESION = "https://almazarela.app.n8n.cloud/webhook-test/0764aae1-cc1b-4f67-9635-5c44ceac4544";
const WEBHOOK_CHAT_CLIENTES = "https://almazarela.app.n8n.cloud/webhook-test/0764aae1-cc1b-4f67-9635-5c44ceac4544";

let usuarioActual = null;

function oauthRedirectUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}

window.loginConGoogle = async function () {
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: oauthRedirectUrl(),
        scopes: "openid email profile",
        queryParams: {
          access_type: "offline",
          prompt: "select_account",
        },
      },
    });
    if (error) throw error;
  } catch (error) {
    console.error("Error al iniciar sesión con Supabase:", error);
    alert("No se pudo completar el inicio de sesión.");
  }
};

window.logoutGoogle = async function () {
  await supabase.auth.signOut();
  document.getElementById("auth-forms").style.display = "block";
  document.getElementById("user-dashboard").style.display = "none";
  document.getElementById("admin-panel-section").style.display = "none";
  usuarioActual = null;
};

supabase.auth.onAuthStateChange(async (event, session) => {
  const user = session?.user || null;
  usuarioActual = user;

  if (user) {
    document.getElementById("auth-forms").style.display = "none";
    document.getElementById("user-dashboard").style.display = "block";
    document.getElementById("user-email-display").innerText = user.email;

    if (event === "SIGNED_IN") {
      fetch(WEBHOOK_INICIO_SESION, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "inicio_sesion",
          uid: user.id,
          email: user.email,
          displayName: user.user_metadata?.full_name || user.email,
          photoURL: user.user_metadata?.avatar_url || "",
          timestamp: new Date().toISOString(),
        }),
      }).catch((err) => console.error("Error enviando inicio de sesión al webhook:", err));
    }

    if (user.email === "almita.zarela@gmail.com" || user.email.includes("admin")) {
      document.getElementById("admin-panel-section").style.display = "block";
    }
  } else {
    document.getElementById("auth-forms").style.display = "block";
    document.getElementById("user-dashboard").style.display = "none";
    document.getElementById("admin-panel-section").style.display = "none";
  }
});

window.enviarMensajeSupabase = async function () {
  const input = document.getElementById("chat-user-input");
  const texto = input.value.trim();
  if (!texto) return;

  if (!usuarioActual) {
    alert("Por favor iniciá sesión para enviar mensajes.");
    window.loginConGoogle();
    return;
  }

  const mensajeData = {
    event: "mensaje_chat",
    sender: usuarioActual.email,
    uid: usuarioActual.id,
    text: texto,
    timestamp: new Date().toISOString(),
  };

  try {
    const area = document.getElementById("chat-messages-container");
    const div = document.createElement("div");
    div.className = "chat-message user-msg";
    div.textContent = texto;
    area.appendChild(div);
    area.scrollTop = area.scrollHeight;

    fetch(WEBHOOK_CHAT_CLIENTES, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mensajeData),
    }).catch((err) => console.error("Error enviando mensaje al webhook chat-clientes:", err));

    input.value = "";
  } catch (e) {
    console.error("Error enviando mensaje: ", e);
  }
};

window.enviarComprobanteSupabase = async function () {
  const fileInput = document.getElementById("chat-file-input");
  const file = fileInput.files[0];
  if (!file) return;

  if (!usuarioActual) {
    alert("Iniciá sesión para adjuntar comprobantes.");
    fileInput.value = "";
    return;
  }

  const reader = new FileReader();
  reader.onload = async function (e) {
    const base64Image = e.target.result;
    const textoAdjunto = "📄 Comprobante adjunto: " + file.name;

    try {
      const area = document.getElementById("chat-messages-container");
      const div = document.createElement("div");
      div.className = "chat-message user-msg";
      div.innerHTML = `<div>${textoAdjunto}</div><img src="${base64Image}" style="max-width:150px; border-radius:8px; margin-top:5px;">`;
      area.appendChild(div);
      area.scrollTop = area.scrollHeight;

      await fetch(WEBHOOK_CHAT_CLIENTES, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "comprobante_adjunto",
          sender: usuarioActual.email,
          uid: usuarioActual.id,
          text: textoAdjunto,
          imagenBase64: base64Image,
          timestamp: new Date().toISOString(),
        }),
      });
      fileInput.value = "";
    } catch (err) {
      console.error("Error al enviar comprobante:", err);
    }
  };
  reader.readAsDataURL(file);
};
