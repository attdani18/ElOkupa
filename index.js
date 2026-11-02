const { Client, GatewayIntentBits, Events } = require("discord.js");

const {
  joinVoiceChannel,
  getVoiceConnection,
  entersState,
  VoiceConnectionStatus,
  NoSubscriberBehavior,
} = require("@discordjs/voice");

// CONFIGURACIÓN
const TOKEN = process.env.DISCORD_TOKEN;
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID;

if (!TOKEN || !VOICE_CHANNEL_ID) {
  console.error("❌ Faltan DISCORD_TOKEN o VOICE_CHANNEL_ID.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

let reconnectTimer = null;
let connecting = false;
let shuttingDown = false;

// CONECTAR AL CANAL DE VOZ
async function conectarVoz() {
  if (connecting || shuttingDown || !client.isReady()) return;

  connecting = true;

  try {
    console.log("🔎 Buscando canal:", VOICE_CHANNEL_ID);

    const canal = await client.channels.fetch(VOICE_CHANNEL_ID);

    if (!canal) {
      throw new Error("No se encontró el canal.");
    }

    console.log("🤖 Bot:", client.user.tag);
    console.log("📢 Canal:", canal.name);
    console.log("🏠 Servidor:", canal.guild?.name);
    console.log("🔢 ID:", canal.id);

    if (!canal.isVoiceBased()) {
      throw new Error("El ID no corresponde a un canal de voz.");
    }

    const conexionActual = getVoiceConnection(canal.guild.id);

    if (conexionActual) {
      if (conexionActual.state.status === VoiceConnectionStatus.Ready) {
        console.log("✅ El Okupa ya está conectado.");
        return;
      }

      conexionActual.destroy();
    }

    console.log("🚪 El Okupa está intentando ocupar el VC...");

    const conexion = joinVoiceChannel({
      channelId: canal.id,
      guildId: canal.guild.id,
      adapterCreator: canal.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: true,
    });

    conexion.on("stateChange", (anterior, nuevo) => {
      console.log(
        `🎙️ Estado de voz: ${anterior.status} → ${nuevo.status}`
      );
    });

    conexion.on("error", (error) => {
      console.error("❌ Error de voz:", error);
    });

    await entersState(
      conexion,
      VoiceConnectionStatus.Ready,
      30000
    );

    console.log("🍌 EL OKUPA YA OCUPÓ LA LLAMADA.");
  } catch (error) {
    console.error("❌ No se pudo conectar al VC:", error);

    const conexion = client.guilds.cache
      .find(g => g.channels.cache.has(VOICE_CHANNEL_ID));

    if (conexion) {
      getVoiceConnection(conexion.id)?.destroy();
    }
  } finally {
    connecting = false;
  }
}

// REVISIÓN AUTOMÁTICA CADA 30 SEGUNDOS
async function revisarConexion() {
  if (!client.isReady() || connecting || shuttingDown) return;

  const canal = client.channels.cache.get(VOICE_CHANNEL_ID);

  if (!canal || !canal.guild) {
    await conectarVoz();
    return;
  }

  const conexion = getVoiceConnection(canal.guild.id);

  if (
    !conexion ||
    conexion.state.status === VoiceConnectionStatus.Destroyed ||
    conexion.state.status === VoiceConnectionStatus.Disconnected
  ) {
    console.log("🔄 El Okupa perdió su casa. Reconectando...");
    await conectarVoz();
  }
}

// CUANDO DISCORD ESTÉ LISTO
client.once(Events.ClientReady, async () => {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🦝 EL OKUPA HA DESPERTADO");
  console.log("🤖 Cuenta:", client.user.tag);
  console.log("🆔 ID:", client.user.id);
  console.log("🏠 Servidores:", client.guilds.cache.size);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  await conectarVoz();

  reconnectTimer = setInterval(revisarConexion, 30000);
});

// ERRORES
client.on(Events.Error, (error) => {
  console.error("❌ Error de Discord:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("❌ Promesa rechazada:", error);
});

process.on("uncaughtException", (error) => {
  console.error("❌ Error inesperado:", error);
});

// APAGADO ORDENADO
function apagar() {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log("🛑 El Okupa está desalojando...");

  if (reconnectTimer) clearInterval(reconnectTimer);

  for (const guild of client.guilds.cache.values()) {
    getVoiceConnection(guild.id)?.destroy();
  }

  client.destroy();
  process.exit(0);
}

process.on("SIGTERM", apagar);
process.on("SIGINT", apagar);

// INICIAR
client.login(TOKEN).catch((error) => {
  console.error("❌ No se pudo iniciar sesión:", error);
  process.exit(1);
});
