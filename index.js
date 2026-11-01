const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const { joinVoiceChannel, getVoiceConnection, VoiceConnectionStatus, entersState } = require('@discordjs/voice');

const token = process.env.DISCORD_TOKEN;
const voiceChannelId = process.env.VOICE_CHANNEL_ID;
if (!token || !voiceChannelId) {
  console.error('Configura DISCORD_TOKEN y VOICE_CHANNEL_ID en Railway.');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates]
});

const frasesTropicales = [
  '¡Dijeron MONO! ¡Permiso, que esto se pone tropical!',
  '¡Banano detectado, nivel de sabrosura aumentando!',
  '¡Explosión tropical inminente!',
  '¡Péguele al mono que se nos va!',
  '¡Puerto Banano nunca se rinde!',
  '¡Hora de la operación sabrosura!'
];
const gifsMonos = [
  'https://media.tenor.com/SZdi4B2MZqwAAAAC/monkey-shoot.gif',
  'https://media.tenor.com/JZMbPXX6kB4AAAAC/monke-shoot.gif',
  'https://media.tenor.com/fmXt2NdKP2kAAAAC/gun-monkey.gif',
  'https://media.tenor.com/N9SSMH09_H8AAAAC/monkey.gif'
];
let contador = 0;
let checkingVoice = false;
let targetChannel;
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

async function keepVoiceConnected() {
  if (checkingVoice || !client.isReady()) return;
  checkingVoice = true;
  try {
    if (!targetChannel) targetChannel = await client.channels.fetch(voiceChannelId);
    if (!targetChannel || ![ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(targetChannel.type)) {
      console.error('VOICE_CHANNEL_ID no corresponde a un canal de voz válido.');
      return;
    }
    const existing = getVoiceConnection(targetChannel.guild.id);
    if (existing && existing.state.status !== VoiceConnectionStatus.Destroyed) {
      if (existing.joinConfig.channelId === targetChannel.id) {
        if (existing.state.status === VoiceConnectionStatus.Ready) return;
        try {
          await entersState(existing, VoiceConnectionStatus.Ready, 12000);
          return;
        } catch { existing.destroy(); }
      } else {
        existing.destroy();
      }
    }
    const connection = joinVoiceChannel({
      channelId: targetChannel.id,
      guildId: targetChannel.guild.id,
      adapterCreator: targetChannel.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: true
    });
    connection.on('error', error => console.error('Error de voz:', error.message));
    await entersState(connection, VoiceConnectionStatus.Ready, 25000);
    console.log('🍌 Sargento Banano conectado a voz.');
  } catch (error) {
    console.error('Fallo de conexión de voz:', error.message);
  } finally {
    checkingVoice = false;
  }
}

client.once('ready', () => {
  console.log(`¡Sargento Banano está en línea como ${client.user.tag}!`);
  keepVoiceConnected();
  setInterval(keepVoiceConnected, 15000);
  setInterval(async () => {
    const canal = client.channels.cache.find(c => c.name === 'muelle-general' && c.isTextBased());
    if (canal) {
      try { await canal.send(`${pick(frasesTropicales)}\n${pick(gifsMonos)}`); }
      catch (error) { console.error('Error enviando GIF:', error.message); }
    }
  }, 15 * 60 * 1000);
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  const contenido = message.content.toLowerCase();
  try {
    if (contenido === '!tirar') {
      contador += 5;
      await message.reply(`¡BANG! ¡Le diste al mono! +5 puntos (Total: ${contador})`);
    }
    if (['mono', 'banano', 'explosión'].some(p => contenido.includes(p))) {
      await message.channel.send(pick(frasesTropicales));
    }
    if (message.attachments.size > 0 || message.content.includes('https://tenor.com')) {
      await message.channel.send('¡Qué sabrosura visual! Esto se va directo a los archivos del comando.');
    }
  } catch (error) { console.error('Error respondiendo:', error.message); }
});

client.on('error', error => console.error('Error del cliente:', error));
client.login(token).catch(error => { console.error('No se pudo iniciar sesión:', error.message); process.exit(1); });
