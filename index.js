
const {
  Client, GatewayIntentBits, Events,
  PermissionFlagsBits, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder,
  ButtonStyle, MessageFlags,
  SlashCommandBuilder
} = require("discord.js");

const {
  joinVoiceChannel, getVoiceConnection,
  entersState, VoiceConnectionStatus
} = require("@discordjs/voice");

const fs = require("node:fs");
const path = require("node:path");
const { getNews, SOURCES } = require("./okupa-news");

const TOKEN = process.env.DISCORD_TOKEN;
const VOICE_ID = process.env.VOICE_CHANNEL_ID;
const PANEL_ID = process.env.DASHBOARD_CHANNEL_ID;
const NEWS_ID = process.env.NEWS_CHANNEL_ID;
const GUILD_ID = process.env.GUILD_ID;
const TZ = "America/Costa_Rica";

if (!TOKEN || !VOICE_ID || !GUILD_ID) {
  console.error("Faltan TOKEN, VOICE_CHANNEL_ID o GUILD_ID");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

const FILE = path.join(__dirname, "okupa-state.json");
const defaults = {
  mode: "lofi",
  volume: 35,
  audio8d: true,
  news: true,
  memes: true,
  voiceAI: false,
  emergency: false,
  filter: "equilibrado",
  panelId: null,
  seen: [],
  lastNewsSlot: null
};

let state = { ...defaults };

try {
  if (fs.existsSync(FILE)) {
    state = {
      ...defaults,
      ...JSON.parse(fs.readFileSync(FILE, "utf8"))
    };
  }
} catch (e) {
  console.error("No se pudo cargar el estado:", e.message);
}

state.voiceAI = false;

function save() {
  try {
    fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error("Error guardando estado:", e.message);
  }
}

function nowCR() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit",
    minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date());

  const get = key => parts.find(
    p => p.type === key
  )?.value;

  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute"))
  };
}

function night() {
  const h = nowCR().hour;
  return h >= 23 || h < 7;
}

function effective() {
  return {
    ...state,
    night: night(),
    volume: state.emergency
      ? 0 : night() ? 15 : state.volume,
    spokenNews: state.news && !night()
      && !state.emergency,
    spokenMemes: state.memes && !night()
      && !state.emergency
  };
}

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

// ========================================
// VOZ PERMANENTE
// ========================================

let stopping = false;
let connecting = false;
let guildId = null;
let retryTimer = null;
let retryCount = 0;
let connectionInProgress = null;

function retry(reason) {
  if (stopping || retryTimer) return;

  const delay = Math.min(
    60000, 5000 * 2 ** Math.min(retryCount++, 4)
  );

  log("Reconexión:", reason, "en", delay, "ms");

  retryTimer = setTimeout(() => {
    retryTimer = null;
    connectVoice().catch(console.error);
  }, delay);
}

async function connectVoice(force = false) {
  if (connecting || stopping || !client.isReady()) return;
  connecting = true;

  try {
    const channel = await client.channels.fetch(
      VOICE_ID, { force: true }
    );

    if (!channel?.isVoiceBased()) {
      throw new Error("VC no encontrado");
    }

    guildId = channel.guild.id;

    const member = await channel.guild.members.fetchMe();
    const perms = channel.permissionsFor(member);

    if (
      !perms?.has(PermissionFlagsBits.ViewChannel) ||
      !perms?.has(PermissionFlagsBits.Connect)
    ) {
      throw new Error("Faltan permisos del VC");
    }

    let conn = getVoiceConnection(guildId);

    if (
      !force &&
      conn?.state.status === VoiceConnectionStatus.Ready &&
      member.voice.channelId === VOICE_ID
    ) {
      retryCount = 0;
      return;
    }

    if (conn) {
      conn.destroy();
    }

    log("Entrando al VC:", channel.name);

    conn = joinVoiceChannel({
      channelId: channel.id,
      guildId,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: true
    });

    connectionInProgress = conn;

    conn.on("error", e => {
      log("Error de voz:", e.message);
    });

    conn.on("stateChange", (oldState, newState) => {
      log("Voz:", oldState.status, "->", newState.status);

      if (newState.status === VoiceConnectionStatus.Ready) {
        retryCount = 0;
      }

      if (newState.status === VoiceConnectionStatus.Disconnected) {
        // Dar tiempo a Discord para recuperar la sesión.
        setTimeout(() => {
          if (
            !stopping &&
            getVoiceConnection(guildId) === conn &&
            conn.state.status ===
              VoiceConnectionStatus.Disconnected
          ) {
            retry("Voz desconectada");
          }
        }, 10000);
      }
    });

    await entersState(
      conn, VoiceConnectionStatus.Ready, 30000
    );

    log("🦝 EL OKUPA OCUPÓ EL VC");
    retryCount = 0;

  } catch (e) {
    log("Falló conexión:", e.message);
    retry("Error de conexión");
  } finally {
    connecting = false;
    connectionInProgress = null;
  }
}

async function checkVoice() {
  if (stopping || connecting || retryTimer) return;
  if (!client.isReady()) return;

  try {
    const channel = await client.channels.fetch(VOICE_ID);
    const member = await channel.guild.members.fetchMe();
    const conn = getVoiceConnection(channel.guild.id);

    if (
      conn?.state.status === VoiceConnectionStatus.Ready &&
      member.voice.channelId === VOICE_ID
    ) return;

    if (
      conn?.state.status === VoiceConnectionStatus.Connecting ||
      conn?.state.status === VoiceConnectionStatus.Signalling
    ) return;

    await connectVoice();
  } catch (e) {
    log("Watchdog:", e.message);
    retry("Watchdog");
  }
}

client.on(Events.VoiceStateUpdate, (oldS, newS) => {
  if (newS.id !== client.user?.id || stopping) return;

  if (newS.channelId !== VOICE_ID) {
    retry("El Okupa salió del VC");
  }
});

// ========================================
// DASHBOARD
// ========================================

function panel() {
  const s = effective();

  const embed = new EmbedBuilder()
    .setTitle("🦝 RADIO OKUPA 506")
    .setColor(s.night ? 0x663399 : 0xff8800)
    .setDescription(
      "La frecuencia que nadie autorizó.\n" +
      "Panel de control de Puerto Banano 506."
    )
    .addFields(
      { name: "Estación", value: s.mode, inline: true },
      { name: "Volumen", value: `${s.volume}%`, inline: true },
      { name: "8D", value: s.audio8d ? "Sí" : "No", inline: true },
      { name: "Madrugada", value: s.night ? "Activa" : "No", inline: true },
      { name: "Noticias", value: s.news ? "Sí" : "No", inline: true },
      { name: "Memes", value: s.memes ? "Sí" : "No", inline: true },
      { name: "Emergencia", value: s.emergency ? "Activa" : "No", inline: true }
    )
    .setFooter({
      text: "Audio real pendiente de integrar"
    });

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ok_lofi")
      .setLabel("Lo-fi")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("ok_sleep")
      .setLabel("Dormir")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("ok_silence")
      .setLabel("Silencio")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("ok_8d")
      .setLabel("8D")
      .setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ok_down")
      .setLabel("Vol -")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("ok_up")
      .setLabel("Vol +")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("ok_news")
      .setLabel("Noticias")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("ok_memes")
      .setLabel("Memes")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("ok_emergency")
      .setLabel("Emergencia")
      .setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [row1, row2] };
}

async function publishPanel() {
  if (!PANEL_ID) throw new Error(
    "Falta DASHBOARD_CHANNEL_ID"
  );

  const channel = await client.channels.fetch(PANEL_ID);

  if (!channel?.isTextBased()) {
    throw new Error("Canal del dashboard inválido");
  }

  if (state.panelId) {
    try {
      const message = await channel.messages.fetch(
        state.panelId
      );
      await message.edit(panel());
      return message;
    } catch {
      state.panelId = null;
    }
  }

  const message = await channel.send(panel());
  state.panelId = message.id;
  save();
  return message;
}

async function refreshPanel() {
  if (!PANEL_ID || !state.panelId) return;

  try {
    const channel = await client.channels.fetch(PANEL_ID);
    const message = await channel.messages.fetch(state.panelId);
    await message.edit(panel());
  } catch (e) {
    log("Panel no actualizado:", e.message);
  }
}

function isMod(interaction) {
  return interaction.memberPermissions?.has(
    PermissionFlagsBits.ManageGuild
  ) || interaction.memberPermissions?.has(
    PermissionFlagsBits.Administrator
  );
}

function statusText() {
  const conn = guildId
    ? getVoiceConnection(guildId) : null;

  const s = effective();

  return [
    `🦝 **El Okupa 3.1**`,
    `VC: ${conn?.state.status || "Desconectado"}`,
    `Estación: ${s.mode}`,
    `Volumen configurado: ${s.volume}%`,
    `Audio 8D: ${s.audio8d ? "Sí" : "No"}`,
    `Madrugada: ${s.night ? "Activa" : "Inactiva"}`,
    `Noticias: ${s.news ? "Sí" : "No"}`,
    `Filtro: ${s.filter}`,
    `Emergencia: ${s.emergency ? "Sí" : "No"}`
  ].join("\n");
}

const commands = [
  new SlashCommandBuilder()
    .setName("dashboard")
    .setDescription("Publicar o recuperar el panel")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    ),

  new SlashCommandBuilder()
    .setName("estado")
    .setDescription("Consultar el estado de El Okupa"),

  new SlashCommandBuilder()
    .setName("reconectar")
    .setDescription("Forzar reconexión al VC")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    ),

  new SlashCommandBuilder()
    .setName("madrugada")
    .setDescription("Consultar horario nocturno"),

  new SlashCommandBuilder()
    .setName("radio")
    .setDescription("Consultar o cambiar estación")
    .addStringOption(o => o
      .setName("modo")
      .setDescription("Estación deseada")
      .addChoices(
        { name: "Lo-fi", value: "lofi" },
        { name: "Dormir", value: "sleep" },
        { name: "Silencio", value: "silence" }
      )
    ),

  new SlashCommandBuilder()
    .setName("emergencia")
    .setDescription("Activar o desactivar emergencia")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    )
    .addBooleanOption(o => o
      .setName("activar")
      .setDescription("Estado de emergencia")
      .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("noticias")
    .setDescription("Noticias reales y configuración")
    .addSubcommand(s => s
      .setName("ahora")
      .setDescription("Consultar titulares recientes")
      .addStringOption(o => o
        .setName("categoria")
        .setDescription("Categoría")
        .addChoices(
          { name: "Todas", value: "todas" },
          { name: "Internacional", value: "internacional" },
          { name: "Ciencia", value: "ciencia" },
          { name: "Medicina", value: "medicina" },
          { name: "Tecnología", value: "tecnologia" }
        )
      )
    )
    .addSubcommand(s => s
      .setName("fuentes")
      .setDescription("Ver fuentes de noticias")
    )
    .addSubcommand(s => s
      .setName("filtro")
      .setDescription("Configurar filtro editorial")
      .addStringOption(o => o
        .setName("nivel")
        .setDescription("Nivel del filtro")
        .setRequired(true)
        .addChoices(
          { name: "Estricto", value: "estricto" },
          { name: "Equilibrado", value: "equilibrado" },
          { name: "Amplio", value: "amplio" }
        )
      )
    )
    .addSubcommand(s => s
      .setName("activar")
      .setDescription("Activar o desactivar noticiero")
      .addBooleanOption(o => o
        .setName("estado")
        .setDescription("Activar noticias")
        .setRequired(true)
      )
    )
].map(c => c.toJSON());

async function registerCommands() {
  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.commands.set(commands);
  log("Comandos / registrados:", commands.length);
}

// ========================================
// INTERACCIONES
// ========================================

client.on(Events.InteractionCreate, async i => {
  try {
    if (i.isButton() && i.customId.startsWith("ok_")) {
      if (!isMod(i)) {
        return i.reply({
          content: "Solo los moderadores pueden usar este control.",
          flags: MessageFlags.Ephemeral
        });
      }

      const id = i.customId;

      if (id === "ok_lofi") state.mode = "lofi";
      if (id === "ok_sleep") state.mode = "sleep";
      if (id === "ok_silence") state.mode = "silence";
      if (id === "ok_8d") state.audio8d = !state.audio8d;
      if (id === "ok_down") {
        state.volume = Math.max(0, state.volume - 5);
      }
      if (id === "ok_up") {
        state.volume = Math.min(100, state.volume + 5);
      }
      if (id === "ok_news") state.news = !state.news;
      if (id === "ok_memes") state.memes = !state.memes;
      if (id === "ok_emergency") {
        state.emergency = !state.emergency;
      }

      save();
      await i.update(panel());
      return;
    }

    if (!i.isChatInputCommand()) return;

    const name = i.commandName;

    if (name === "estado") {
      return i.reply({
        content: statusText(),
        flags: MessageFlags.Ephemeral
      });
    }

    if (name === "madrugada") {
      return i.reply({
        content:
          "🌙 Modo madrugada: 23:00–07:00 (Costa Rica).\n" +
          `Estado: ${night() ? "Activo" : "Inactivo"}\n` +
          "Volumen nocturno: 15%.\n" +
          "Sin memes ni noticias habladas.",
        flags: MessageFlags.Ephemeral
      });
    }

    if (name === "noticias") {
      const sub = i.options.getSubcommand();

      if (sub === "fuentes") {
        return i.reply({
          content: SOURCES.map(s =>
            `**${s.category} — ${s.name}**\n${s.url}`
          ).join("\n\n"),
          flags: MessageFlags.Ephemeral
        });
      }

      if (sub === "filtro" || sub === "activar") {
        if (!isMod(i)) {
          return i.reply({
            content: "Solo moderadores.",
            flags: MessageFlags.Ephemeral
          });
        }

        if (sub === "filtro") {
          state.filter = i.options.getString("nivel");
        } else {
          state.news = i.options.getBoolean("estado");
        }

        save();
        await refreshPanel();

        return i.reply({
          content: "Configuración de noticias actualizada.",
          flags: MessageFlags.Ephemeral
        });
      }

      if (sub === "ahora") {
        await i.deferReply({
          flags: MessageFlags.Ephemeral
        });

        const category =
          i.options.getString("categoria") || "todas";

        const articles = await getNews({
          category,
          filter: state.filter
        });

        if (!articles.length) {
          return i.editReply(
            "No encontré noticias que superen el filtro."
          );
        }

        const text = articles.slice(0, 4).map(a =>
          `**${a.title.replace(/@/g, "@\u200b")}**\n` +
          `${a.source} · ${new Date(a.published)
            .toLocaleDateString("es-CR", { timeZone: TZ })}\n` +
          a.url
        ).join("\n\n");

        return i.editReply({
          content: text.slice(0, 1900),
          allowedMentions: { parse: [] }
        });
      }
    }

    if (!isMod(i)) {
      return i.reply({
        content: "Solo moderadores.",
        flags: MessageFlags.Ephemeral
      });
    }

    if (name === "dashboard") {
      await i.deferReply({
        flags: MessageFlags.Ephemeral
      });
      const message = await publishPanel();
      return i.editReply(
        `Dashboard disponible: ${message.url}`
      );
    }

    if (name === "reconectar") {
      await i.deferReply({
        flags: MessageFlags.Ephemeral
      });
      await connectVoice(true);
      return i.editReply(
        "Reconexión solicitada. Revisá /estado."
      );
    }

    if (name === "radio") {
      const mode = i.options.getString("modo");
      if (mode) state.mode = mode;
      save();
      await refreshPanel();
      return i.reply({
        content: `Estación configurada: ${state.mode}`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (name === "emergencia") {
      state.emergency =
        i.options.getBoolean("activar");
      save();
      await refreshPanel();
      return i.reply({
        content: state.emergency
          ? "🚨 Emergencia activada."
          : "Emergencia desactivada.",
        flags: MessageFlags.Ephemeral
      });
    }

  } catch (error) {
    console.error("Error de interacción:", error);

    const response = {
      content: "Ocurrió un error. Revisá los logs.",
      flags: MessageFlags.Ephemeral
    };

    try {
      if (i.deferred || i.replied) {
        await i.editReply(response.content);
      } else {
        await i.reply(response);
      }
    } catch {}
  }
});

// ========================================
// BOLETINES AUTOMÁTICOS
// ========================================

let newsRunning = false;

async function newsTick() {
  if (newsRunning || !client.isReady()) return;
  if (!NEWS_ID || !state.news || night()) return;

  const time = nowCR();
  if (![8, 12, 17, 21].includes(time.hour)) return;

  const slot = `${time.date}-${time.hour}`;
  if (state.lastNewsSlot === slot) return;

  newsRunning = true;

  try {
    const channel = await client.channels.fetch(NEWS_ID);

    if (!channel?.isTextBased()) {
      throw new Error("Canal de noticias inválido");
    }

    const articles = await getNews({
      filter: state.filter,
      seen: state.seen
    });

    const selected = [];
    const categories = [...new Set(
      articles.map(a => a.category)
    )];

    for (const category of categories) {
      const article = articles.find(
        a => a.category === category
      );
      if (article) selected.push(article);
    }

    for (const article of selected.slice(0, 4)) {
      await channel.send({
        content:
          `📰 **${article.category.toUpperCase()}**\n` +
          `**${article.title.replace(/@/g, "@\u200b")}**\n` +
          `Fuente: ${article.source}\n` +
          article.url,
        allowedMentions: { parse: [] }
      });

      state.seen.push(article.id, article.titleId);
      state.seen = state.seen.slice(-2000);
      save();
    }

    // Marcar el horario solamente si hubo artículos
    // válidos; si no, se intentará más tarde.
    if (articles.length) {
      state.lastNewsSlot = slot;
      save();
    }

    log("Boletín publicado:", selected.length);
  } catch (error) {
    log("Error de noticias:", error.message);
  } finally {
    newsRunning = false;
  }
}

// ========================================
// INICIO
// ========================================

let watchdogTimer;
let newsTimer;
let panelTimer;
let lastNight = null;

client.once(Events.ClientReady, async () => {
  log("🦝 EL OKUPA 3.1 HA DESPERTADO");
  log("Cuenta:", client.user.tag);

  try {
    await registerCommands();
  } catch (e) {
    log("Error registrando comandos:", e.message);
  }

  await connectVoice();

  watchdogTimer = setInterval(() => {
    checkVoice().catch(console.error);
  }, 15000);

  newsTimer = setInterval(() => {
    newsTick().catch(console.error);
  }, 60000);

  newsTick().catch(console.error);

  try {
    await publishPanel();
  } catch (e) {
    log("Dashboard:", e.message);
  }

  lastNight = night();

  panelTimer = setInterval(() => {
    const current = night();

    if (current !== lastNight) {
      lastNight = current;
      log(current
        ? "🌙 Modo madrugada activado"
        : "☀️ Modo diurno activado"
      );
      refreshPanel().catch(console.error);
    }
  }, 30000);
});

client.on(Events.Error, console.error);

client.on(Events.ShardResume, () => {
  checkVoice().catch(console.error);
});

process.on("unhandledRejection", console.error);

// ========================================
// APAGADO
// ========================================

function shutdown() {
  if (stopping) return;
  stopping = true;

  clearInterval(watchdogTimer);
  clearInterval(newsTimer);
  clearInterval(panelTimer);
  clearTimeout(retryTimer);

  if (guildId) {
    getVoiceConnection(guildId)?.destroy();
  }

  client.destroy();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

client.login(TOKEN).catch(error => {
  console.error("Error de login:", error);
  process.exit(1);
});
