
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

// ==========================================
// 🦝 EL OKUPA - VOZ PERMANENTE 24/7
// ==========================================

const TOKEN = process.env.DISCORD_TOKEN;
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID;

const CHECK_INTERVAL = 15000;
const CONNECT_TIMEOUT = 30000;
const DISCONNECT_GRACE = 10000;
const MAX_RETRY_DELAY = 60000;

if (!TOKEN || !VOICE_CHANNEL_ID) {
  console.error("❌ Faltan variables de Railway.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

let targetGuildId = null;
let connecting = false;
let stopping = false;
let checkTimer = null;
let retryTimer = null;
let retryCount = 0;
let activeConnection = null;
let recoveryPromise = null;

// ==========================================
// UTILIDADES
// ==========================================

function log(message) {
  console.log(
    `[${new Date().toISOString()}] ${message}`
  );
}

function retryDelay() {
  return Math.min(
    5000 * Math.pow(2, Math.min(retryCount, 4)),
    MAX_RETRY_DELAY
  );
}

function scheduleReconnect(reason) {
  if (stopping || retryTimer) return;

  const delay = retryDelay();
  retryCount++;

  log(
    `🔄 ${reason}. Nuevo intento en ${delay / 1000}s.`
  );

  retryTimer = setTimeout(() => {
    retryTimer = null;
    conectarVoz().catch(console.error);
  }, delay);
}

function destroyConnection(guildId) {
  const connection = getVoiceConnection(guildId);

  if (connection) {
    connection.destroy();
  }

  if (activeConnection === connection) {
    activeConnection = null;
  }
}

// ==========================================
// EVENTOS DE VOZ
// ==========================================

function registerConnection(connection) {
  if (activeConnection === connection) return;

  activeConnection = connection;

  connection.on("stateChange", (oldState, newState) => {
    log(
      `🎙️ Voz: ${oldState.status} → ${newState.status}`
    );

    if (
      newState.status === VoiceConnectionStatus.Ready
    ) {
      retryCount = 0;

      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }

      log("✅ Conexión de voz lista.");
    }

    if (
      newState.status === VoiceConnectionStatus.Disconnected
    ) {
      log("⚠️ Voz desconectada. Evaluando recuperación...");

      if (!recoveryPromise) {
        recoveryPromise = recoverDisconnected(connection)
          .finally(() => {
            recoveryPromise = null;
          });
      }
    }

    if (
      newState.status === VoiceConnectionStatus.Destroyed
    ) {
      log("🧹 Conexión destruida.");
    }
  });

  connection.on("error", (error) => {
    console.error("❌ Error de voz:", error);
  });
}

// ==========================================
// RECUPERAR DESCONEXIONES
// ==========================================

async function recoverDisconnected(connection) {
  try {
    await Promise.race([
      entersState(
        connection,
        VoiceConnectionStatus.Signalling,
        DISCONNECT_GRACE
      ),
      entersState(
        connection,
        VoiceConnectionStatus.Connecting,
        DISCONNECT_GRACE
      ),
      entersState(
        connection,
        VoiceConnectionStatus.Ready,
        DISCONNECT_GRACE
      ),
    ]);

    log("🔁 Discord está recuperando la conexión.");

  } catch {
    if (stopping) return;

    log("⚠️ No se recuperó la conexión.");

    if (
      targetGuildId &&
      getVoiceConnection(targetGuildId) === connection
    ) {
      destroyConnection(targetGuildId);
    }

    scheduleReconnect("Conexión perdida");
  }
}

// ==========================================
// CONECTAR AL VC
// ==========================================

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

    const member = await canal.guild.members.fetchMe();
    const permissions = canal.permissionsFor(member);

    if (
      !permissions?.has(PermissionFlagsBits.ViewChannel) ||
      !permissions?.has(PermissionFlagsBits.Connect)
    ) {
      throw new Error(
        "Faltan permisos ViewChannel o Connect."
      );
    }

    const currentConnection =
      getVoiceConnection(targetGuildId);

    const inCorrectChannel =
      member.voice.channelId === VOICE_CHANNEL_ID;

    if (
      currentConnection?.state.status ===
        VoiceConnectionStatus.Ready &&
      inCorrectChannel
    ) {
      retryCount = 0;
      return;
    }

    if (currentConnection) {
      log("🧹 Limpiando conexión anterior...");
      destroyConnection(targetGuildId);
    }

    log(`🦝 Bot: ${client.user.tag}`);
    log(`🏠 Servidor: ${canal.guild.name}`);
    log(`🎙️ Canal: ${canal.name}`);
    log("🚪 Intentando ocupar el VC...");

    const connection = joinVoiceChannel({
      channelId: canal.id,
      guildId: canal.guild.id,
      adapterCreator: canal.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: true,
    });

    registerConnection(connection);

    await entersState(
      connection,
      VoiceConnectionStatus.Ready,
      CONNECT_TIMEOUT
    );

    log("🍌 EL OKUPA OCUPÓ SU CASA.");
    retryCount = 0;

  } catch (error) {
    console.error(
      "❌ Falló conexión:",
      error.message
    );

    if (targetGuildId) {
      destroyConnection(targetGuildId);
    }

  } finally {
    connecting = false;

    if (
      !stopping &&
      targetGuildId &&
      !getVoiceConnection(targetGuildId)
    ) {
      scheduleReconnect("Reintentando ocupar el VC");
    }
  }
}

// ==========================================
// VIGILANCIA CADA 15 SEGUNDOS
// ==========================================

async function revisarConexion() {
  if (
    stopping ||
    connecting ||
    !client.isReady() ||
    recoveryPromise ||
    retryTimer
  ) {
    return;
  }

  try {
    const canal = await client.channels.fetch(
      VOICE_CHANNEL_ID
    );

    if (!canal || !canal.isVoiceBased()) {
      throw new Error("Canal no disponible.");
    }

    const member = await canal.guild.members.fetchMe();

    const connection =
      getVoiceConnection(canal.guild.id);

    const isReady =
      connection?.state.status ===
      VoiceConnectionStatus.Ready;

    const inCorrectChannel =
      member.voice.channelId === VOICE_CHANNEL_ID;

    if (isReady && inCorrectChannel) {
      return;
    }

    log("🔎 El Okupa está fuera de su VC.");
    await conectarVoz();

  } catch (error) {
    console.error(
      "⚠️ Error de vigilancia:",
      error.message
    );

    scheduleReconnect("Error de vigilancia");
  }
}

// ==========================================
// DETECTAR DESCONEXIONES
// ==========================================

client.on(
  Events.VoiceStateUpdate,
  (oldState, newState) => {
    if (!client.user || stopping) return;
    if (newState.id !== client.user.id) return;

    if (newState.channelId !== VOICE_CHANNEL_ID) {
      log("🚨 El Okupa salió del canal.");

      scheduleReconnect("Regresando al VC");
    }
  }
);

// ==========================================
// INICIO
// ==========================================

client.once(Events.ClientReady, async () => {
  log("━━━━━━━━━━━━━━━━━━━━━━━━");
  log("🦝 EL OKUPA HA DESPERTADO");
  log(`🤖 Cuenta: ${client.user.tag}`);
  log(`🆔 ID: ${client.user.id}`);
  log(`🏠 Servidores: ${client.guilds.cache.size}`);
  log("━━━━━━━━━━━━━━━━━━━━━━━━");

  await conectarVoz();

  checkTimer = setInterval(
    revisarConexion,
    CHECK_INTERVAL
  );
});

// ==========================================
// ERRORES
// ==========================================

client.on(Events.Error, (error) => {
  console.error("❌ Discord:", error);
});

client.on(Events.ShardDisconnect, (event, shardId) => {
  log(
    `⚠️ Gateway desconectado. Shard ${shardId}, código ${event.code}`
  );
});

client.on(Events.ShardResume, (shardId) => {
  log(`✅ Gateway recuperado. Shard ${shardId}`);
  revisarConexion().catch(console.error);
});

process.on("unhandledRejection", (error) => {
  console.error("❌ Promesa rechazada:", error);
});

process.on("uncaughtException", (error) => {
  console.error("❌ Error inesperado:", error);
});

// ==========================================
// APAGADO
// ==========================================

function shutdown() {
  if (stopping) return;

  stopping = true;
  log("🛑 El Okupa se está apagando.");

  if (checkTimer) clearInterval(checkTimer);
  if (retryTimer) clearTimeout(retryTimer);

  if (targetGuildId) {
    destroyConnection(targetGuildId);
  }

  client.destroy();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// ==========================================
// LOGIN
// ==========================================

client.login(TOKEN).catch((error) => {
  console.error("❌ Error iniciando sesión:", error);
  process.exit(1);
});
