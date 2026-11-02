const {
  Client,
  GatewayIntentBits,
  Events,
  PermissionFlagsBits,
} = require("discord.js");

const {
  joinVoiceChannel,
  getVoiceConnection,
  entersState,
  VoiceConnectionStatus,
} = require("@discordjs/voice");

// =====================================
// CONFIGURACIÓN
// =====================================

const TOKEN = process.env.DISCORD_TOKEN;
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID;

const CHECK_INTERVAL = 15000;
const CONNECT_TIMEOUT = 30000;

if (!TOKEN || !VOICE_CHANNEL_ID) {
  console.error("❌ Faltan variables de Railway.");
  process.exit(1);
}

// =====================================
// CLIENTE DISCORD
// =====================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

let connecting = false;
let stopping = false;
let checkTimer = null;
let targetGuildId = null;
let activeConnection = null;

// =====================================
// REGISTROS DE VOZ
// =====================================

function registrarConexion(connection) {
  if (activeConnection === connection) return;

  activeConnection = connection;

  connection.on("stateChange", (oldState, newState) => {
    console.log(
      `🎙️ Voz: ${oldState.status} → ${newState.status}`
    );

    if (
      newState.status === VoiceConnectionStatus.Disconnected
    ) {
      console.log("⚠️ El Okupa perdió la conexión.");
    }
  });

  connection.on("error", (error) => {
    console.error("❌ Error de voz:", error);
  });
}

// =====================================
// CONECTAR AL VC
// =====================================

async function conectarVoz() {
  if (connecting || stopping || !client.isReady()) {
    return;
  }

  connecting = true;

  try {
    const canal = await client.channels.fetch(
      VOICE_CHANNEL_ID,
      { force: true }
    );

    if (!canal || !canal.isVoiceBased()) {
      throw new Error(
        "No se encontró un canal de voz válido."
      );
    }

    targetGuildId = canal.guild.id;

    const botMember = await canal.guild.members.fetchMe();

    const permisos = canal.permissionsFor(botMember);

    if (
      !permisos?.has(PermissionFlagsBits.ViewChannel) ||
      !permisos?.has(PermissionFlagsBits.Connect)
    ) {
      throw new Error(
        "El Okupa no tiene permisos para ver o conectar al VC."
      );
    }

    console.log("━━━━━━━━━━━━━━━━━━━━");
    console.log("🦝 Bot:", client.user.tag);
    console.log("🏠 Servidor:", canal.guild.name);
    console.log("🎙️ Canal:", canal.name);
    console.log("━━━━━━━━━━━━━━━━━━━━");

    let connection = getVoiceConnection(canal.guild.id);

    const inCorrectChannel =
      botMember.voice.channelId === VOICE_CHANNEL_ID;

    const isReady =
      connection?.state.status ===
      VoiceConnectionStatus.Ready;

    if (isReady && inCorrectChannel) {
      return;
    }

    // Eliminar conexiones anteriores o atascadas.
    if (connection) {
      console.log("🧹 Limpiando conexión anterior...");
      connection.destroy();
      activeConnection = null;
    }

    console.log("🚪 Intentando ocupar el canal...");

    connection = joinVoiceChannel({
      channelId: canal.id,
      guildId: canal.guild.id,
      adapterCreator: canal.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: true,
    });

    registrarConexion(connection);

    await entersState(
      connection,
      VoiceConnectionStatus.Ready,
      CONNECT_TIMEOUT
    );

    console.log("✅ EL OKUPA OCUPÓ EL VC.");
    console.log("🍌 No necesita compañía para quedarse.");

  } catch (error) {
    console.error(
      "❌ Error al conectar:",
      error.message
    );

    if (targetGuildId) {
      const connection = getVoiceConnection(targetGuildId);

      if (connection) {
        connection.destroy();
        activeConnection = null;
      }
    }
  } finally {
    connecting = false;
  }
}

// =====================================
// VIGILANCIA AUTOMÁTICA
// =====================================

async function revisarConexion() {
  if (stopping || connecting || !client.isReady()) {
    return;
  }

  try {
    const canal = await client.channels.fetch(
      VOICE_CHANNEL_ID
    );

    if (!canal || !canal.isVoiceBased()) {
      console.log("⚠️ Canal no disponible.");
      return;
    }

    const member = await canal.guild.members.fetchMe();

    const connection = getVoiceConnection(canal.guild.id);

    const isReady =
      connection?.state.status ===
      VoiceConnectionStatus.Ready;

    const inCorrectChannel =
      member.voice.channelId === VOICE_CHANNEL_ID;

    if (!isReady || !inCorrectChannel) {
      console.log(
        "🔄 El Okupa está fuera de su casa. Recuperando VC..."
      );

      await conectarVoz();
    }

  } catch (error) {
    console.error(
      "⚠️ Error en vigilancia:",
      error.message
    );
  }
}

// =====================================
// DETECTAR CAMBIOS EN EL VC
// =====================================

client.on(
  Events.VoiceStateUpdate,
  async (oldState, newState) => {

    if (!client.user || stopping) return;

    // Solo reaccionar a cambios del propio bot.
    if (newState.id !== client.user.id) return;

    if (newState.channelId !== VOICE_CHANNEL_ID) {
      console.log(
        "🚨 ¡Sacaron al Okupa de su VC!"
      );

      await conectarVoz();
    }
  }
);

// =====================================
// INICIO DEL BOT
// =====================================

client.once(Events.ClientReady, async () => {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🦝 EL OKUPA HA DESPERTADO");
  console.log("🤖 Cuenta:", client.user.tag);
  console.log("🆔 ID:", client.user.id);
  console.log("🏠 Servidores:", client.guilds.cache.size);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━");

  await conectarVoz();

  checkTimer = setInterval(
    revisarConexion,
    CHECK_INTERVAL
  );
});

// =====================================
// ERRORES
// =====================================

client.on(Events.Error, (error) => {
  console.error("❌ Discord:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("❌ Promesa rechazada:", error);
});

process.on("uncaughtException", (error) => {
  console.error("❌ Error inesperado:", error);
});

// =====================================
// APAGADO ORDENADO
// =====================================

function apagar() {
  if (stopping) return;

  stopping = true;

  console.log("🛑 El Okupa está cerrando...");

  if (checkTimer) {
    clearInterval(checkTimer);
  }

  if (targetGuildId) {
    getVoiceConnection(targetGuildId)?.destroy();
  }

  client.destroy();
  process.exit(0);
}

process.on("SIGTERM", apagar);
process.on("SIGINT", apagar);

// =====================================
// LOGIN
// =====================================

client.login(TOKEN).catch((error) => {
  console.error(
    "❌ No se pudo iniciar sesión:",
    error
  );

  process.exit(1);
});
