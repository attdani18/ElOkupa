
const {
  Client,
  GatewayIntentBits,
  Events,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");

const {
  joinVoiceChannel,
  getVoiceConnection,
  entersState,
  VoiceConnectionStatus,
} = require("@discordjs/voice");

// ==========================================
// EL OKUPA 3.0 - RADIO OKUPA 506
// ==========================================

const TOKEN = process.env.DISCORD_TOKEN;
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID;
const DASHBOARD_CHANNEL_ID =
  process.env.DASHBOARD_CHANNEL_ID;

const CHECK_INTERVAL = 15000;
const CONNECT_TIMEOUT = 30000;
const DISCONNECT_GRACE = 10000;
const MAX_RETRY_DELAY = 60000;

if (!TOKEN || !VOICE_CHANNEL_ID) {
  console.error("Faltan variables de Railway.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const settings = {
  mode: "lofi",
  audio8d: true,
  volume: 35,
  news: true,
  memes: true,
  voiceAI: false,
};

let targetGuildId = null;
let connecting = false;
let stopping = false;
let checkTimer = null;
let retryTimer = null;
let retryCount = 0;
let activeConnection = null;
let recoveryPromise = null;
let nightTimer = null;
let dashboardMessage = null;

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
  if (stopping || retryTimer || connecting) return;

  const delay = retryDelay();
  retryCount++;

  log(
    `Reconexión: ${reason}. Intento en ${delay / 1000}s.`
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
// MODO MADRUGADA - COSTA RICA
// ==========================================

function isNightMode() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Costa_Rica",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());

  const hour = Number(
    parts.find(p => p.type === "hour").value
  );

  return hour >= 23 || hour < 7;
}

function getEffectiveSettings() {
  const night = isNightMode();

  return {
    ...settings,
    nightMode: night,
    volume: night ? 15 : settings.volume,
    allowSpokenNews: night ? false : settings.news,
    allowSpokenMemes: night ? false : settings.memes,
    voiceAI: false,
  };
}

let previousNightState = null;

function checkNightMode() {
  const effective = getEffectiveSettings();

  if (effective.nightMode !== previousNightState) {
    previousNightState = effective.nightMode;

    log(
      effective.nightMode
        ? "Modo madrugada activado."
        : "Modo diurno activado."
    );

    log(`Volumen configurado: ${effective.volume}%`);
    log(
      `Noticias habladas: ${effective.allowSpokenNews}`
    );
    log(
      `Memes hablados: ${effective.allowSpokenMemes}`
    );

    updateDashboard().catch(console.error);
  }
}

// ==========================================
// EVENTOS DE CONEXIÓN
// ==========================================

function registerConnection(connection) {
  if (activeConnection === connection) return;

  activeConnection = connection;

  connection.on("stateChange", (oldState, newState) => {
    log(
      `Voz: ${oldState.status} -> ${newState.status}`
    );

    if (newState.status === VoiceConnectionStatus.Ready) {
      retryCount = 0;

      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }

      log("Conexión de voz lista.");
    }

    if (
      newState.status ===
      VoiceConnectionStatus.Disconnected
    ) {
      log("Voz desconectada. Evaluando recuperación...");

      if (!recoveryPromise) {
        recoveryPromise = recoverDisconnected(connection)
          .finally(() => {
            recoveryPromise = null;
          });
      }
    }
  });

  connection.on("error", error => {
    console.error("Error de voz:", error);
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

    log("Discord está recuperando la conexión.");
  } catch {
    if (stopping) return;

    log("La conexión no se recuperó a tiempo.");

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
      throw new Error("Canal de voz no encontrado.");
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
      log("Limpiando conexión anterior...");
      destroyConnection(targetGuildId);
    }

    log(`Bot: ${client.user.tag}`);
    log(`Servidor: ${canal.guild.name}`);
    log(`Canal: ${canal.name}`);
    log("Intentando ocupar el VC...");

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

    log("EL OKUPA OCUPÓ SU CASA.");
    retryCount = 0;

  } catch (error) {
    console.error("Falló conexión:", error.message);

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
// VIGILANCIA
// ==========================================

async function revisarConexion() {
  if (stopping || connecting || !client.isReady()) {
    return;
  }

  if (recoveryPromise || retryTimer) return;

  try {
    const canal = await client.channels.fetch(
      VOICE_CHANNEL_ID
    );

    if (!canal || !canal.isVoiceBased()) {
      throw new Error("Canal no disponible.");
    }

    const member = await canal.guild.members.fetchMe();
    const connection = getVoiceConnection(canal.guild.id);

    const inCorrectChannel =
      member.voice.channelId === VOICE_CHANNEL_ID;

    if (
      connection?.state.status ===
        VoiceConnectionStatus.Ready &&
      inCorrectChannel
    ) {
      return;
    }

    log("El Okupa está fuera de su casa.");
    await conectarVoz();

  } catch (error) {
    console.error("Error de vigilancia:", error.message);
    scheduleReconnect("Error de vigilancia");
  }
}

client.on(
  Events.VoiceStateUpdate,
  (oldState, newState) => {
    if (stopping || !client.user) return;
    if (newState.id !== client.user.id) return;

    if (newState.channelId !== VOICE_CHANNEL_ID) {
      log("El Okupa salió del canal configurado.");
      scheduleReconnect("Regresando al VC");
    }
  }
);

// ==========================================
// DASHBOARD DE RADIO OKUPA 506
// ==========================================

function buildDashboard() {
  const s = getEffectiveSettings();

  const embed = new EmbedBuilder()
    .setColor(s.nightMode ? 0x483d8b : 0xff8c00)
    .setTitle("🦝 RADIO OKUPA 506")
    .setDescription(
      "La frecuencia que nadie autorizó.\n" +
      "Centro de control de Puerto Banano 506."
    )
    .addFields(
      {
        name: "Estación",
        value: s.mode.toUpperCase(),
        inline: true,
      },
      {
        name: "Volumen",
        value: `${s.volume}%`,
        inline: true,
      },
      {
        name: "Audio 8D",
        value: s.audio8d ? "Activado" : "Desactivado",
        inline: true,
      },
      {
        name: "Modo madrugada",
        value: s.nightMode ? "Activo" : "Inactivo",
        inline: true,
      },
      {
        name: "Noticias habladas",
        value: s.allowSpokenNews ? "Sí" : "No",
        inline: true,
      },
      {
        name: "Memes hablados",
        value: s.allowSpokenMemes ? "Sí" : "No",
        inline: true,
      },
      {
        name: "Interacción por voz",
        value: "Desactivada",
        inline: true,
      }
    )
    .setFooter({
      text: "El Okupa 3.0 | Hora de Costa Rica"
    });

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("okupa_lofi")
      .setLabel("Lo-fi")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("okupa_sleep")
      .setLabel("Dormir")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("okupa_silence")
      .setLabel("Silencio")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("okupa_8d")
      .setLabel("Audio 8D")
      .setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("okupa_vol_down")
      .setLabel("Vol -")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("okupa_vol_up")
      .setLabel("Vol +")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("okupa_news")
      .setLabel("Noticias")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("okupa_memes")
      .setLabel("Memes")
      .setStyle(ButtonStyle.Secondary)
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("okupa_status")
      .setLabel("Estado")
      .setStyle(ButtonStyle.Success)
  );

  return {
    embeds: [embed],
    components: [row1, row2, row3],
  };
}

async function updateDashboard() {
  if (!dashboardMessage) return;

  try {
    await dashboardMessage.edit(buildDashboard());
  } catch (error) {
    console.error(
      "Error actualizando dashboard:",
      error.message
    );
  }
}

async function publishDashboard() {
  if (!DASHBOARD_CHANNEL_ID) {
    log("Dashboard desactivado: falta DASHBOARD_CHANNEL_ID.");
    return;
  }

  const channel = await client.channels.fetch(
    DASHBOARD_CHANNEL_ID
  );

  if (!channel || !channel.isTextBased()) {
    throw new Error(
      "El canal del dashboard no admite mensajes."
    );
  }

  dashboardMessage = await channel.send(
    buildDashboard()
  );

  log("Dashboard publicado correctamente.");
}

// ==========================================
// BOTONES
// ==========================================

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("okupa_")) return;

  if (interaction.customId === "okupa_status") {
    const connection = targetGuildId
      ? getVoiceConnection(targetGuildId)
      : null;

    return interaction.reply({
      content:
        `🦝 Estado: ${connection?.state.status || "Sin conexión"}\n` +
        `🌙 Madrugada: ${isNightMode() ? "Sí" : "No"}\n` +
        `🔊 Volumen: ${getEffectiveSettings().volume}%`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const authorized =
    interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageGuild
    ) ||
    interaction.memberPermissions?.has(
      PermissionFlagsBits.Administrator
    );

  if (!authorized) {
    return interaction.reply({
      content: "Solo los moderadores pueden cambiar la radio.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const id = interaction.customId;

  if (id === "okupa_lofi") settings.mode = "lofi";
  if (id === "okupa_sleep") settings.mode = "sleep";
  if (id === "okupa_silence") settings.mode = "silence";

  if (id === "okupa_8d") {
    settings.audio8d = !settings.audio8d;
  }

  if (id === "okupa_vol_down") {
    settings.volume = Math.max(0, settings.volume - 5);
  }

  if (id === "okupa_vol_up") {
    settings.volume = Math.min(100, settings.volume + 5);
  }

  if (id === "okupa_news") {
    settings.news = !settings.news;
  }

  if (id === "okupa_memes") {
    settings.memes = !settings.memes;
  }

  await interaction.update(buildDashboard());

  log(`Dashboard actualizado por ${interaction.user.tag}`);
});

// ==========================================
// INICIO DEL BOT
// ==========================================

client.once(Events.ClientReady, async () => {
  log("━━━━━━━━━━━━━━━━━━━━━━━━");
  log("🦝 EL OKUPA 3.0 HA DESPERTADO");
  log(`Cuenta: ${client.user.tag}`);
  log(`ID: ${client.user.id}`);
  log(`Servidores: ${client.guilds.cache.size}`);
  log("━━━━━━━━━━━━━━━━━━━━━━━━");

  // Conexión permanente al VC
  await conectarVoz();

  // Vigilar la conexión cada 15 segundos
  checkTimer = setInterval(
    revisarConexion,
    CHECK_INTERVAL
  );

  // Activar modo madrugada
  checkNightMode();

  nightTimer = setInterval(
    checkNightMode,
    30000
  );

  // Publicar dashboard
  try {
    await publishDashboard();
  } catch (error) {
    console.error(
      "Error publicando dashboard:",
      error.message
    );
  }
});

// ==========================================
// EVENTOS Y ERRORES
// ==========================================

client.on(Events.Error, error => {
  console.error("Error de Discord:", error);
});

client.on(Events.ShardDisconnect, (event, shardId) => {
  log(
    `Gateway desconectado. Shard ${shardId}, código ${event.code}`
  );
});

client.on(Events.ShardResume, shardId => {
  log(`Gateway recuperado. Shard ${shardId}`);
  revisarConexion().catch(console.error);
});

process.on("unhandledRejection", error => {
  console.error("Promesa rechazada:", error);
});

process.on("uncaughtException", error => {
  console.error("Error inesperado:", error);
});

// ==========================================
// APAGADO
// ==========================================

function shutdown() {
  if (stopping) return;

  stopping = true;

  log("El Okupa está cerrando.");

  if (checkTimer) clearInterval(checkTimer);
  if (retryTimer) clearTimeout(retryTimer);
  if (nightTimer) clearInterval(nightTimer);

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

client.login(TOKEN).catch(error => {
  console.error("Error iniciando sesión:", error);
  process.exit(1);
});
