
const { Client, GatewayIntentBits } = require('discord.js');
const {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState
} = require('@discordjs/voice');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ]
});

const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID;

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

// CONEXIÓN PERMANENTE A VOZ
async function conectarVoz() {
  if (!VOICE_CHANNEL_ID) {
    console.log('Falta configurar VOICE_CHANNEL_ID');
    return;
  }

  try {
    const canal = await client.channels.fetch(VOICE_CHANNEL_ID);

    if (!canal || !canal.isVoiceBased()) {
      console.log('El canal configurado no es de voz.');
      return;
    }

    let conexion = getVoiceConnection(canal.guild.id);

    if (conexion &&
        conexion.state.status !== VoiceConnectionStatus.Destroyed &&
        conexion.joinConfig.channelId === canal.id) {
      if (conexion.state.status === VoiceConnectionStatus.Ready) {
        return;
      }

      try {
        await entersState(
          conexion,
          VoiceConnectionStatus.Ready,
          15000
        );
        return;
      } catch {
        conexion.destroy();
      }
    } else if (conexion) {
      conexion.destroy();
    }

    conexion = joinVoiceChannel({
      channelId: canal.id,
      guildId: canal.guild.id,
      adapterCreator: canal.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: true
    });

    conexion.on('error', error => {
      console.error('Error de voz:', error);
    });

    await entersState(
      conexion,
      VoiceConnectionStatus.Ready,
      30000
    );

    console.log('🍌 Sargento Banano conectado a voz.');

  } catch (error) {
    console.error('Error conectando a voz:', error.message);
  }
}

client.once('ready', () => {
  console.log(`¡Sargento Banano está en línea como ${client.user.tag}!`);

  conectarVoz();

  // Revisar la conexión cada 30 segundos
  setInterval(conectarVoz, 30 * 1000);

  // Mensaje automático cada 15 minutos
  setInterval(() => {
    const canal = client.channels.cache.find(
      c => c.name === 'muelle-general' && c.isTextBased()
    );

    if (canal) {
      const frase = frasesTropicales[
        Math.floor(Math.random() * frasesTropicales.length)
      ];

      const gif = gifsMonos[
        Math.floor(Math.random() * gifsMonos.length)
      ];

      canal.send(`${frase}\n${gif}`).catch(console.error);
    }
  }, 15 * 60 * 1000);
});

client.on('messageCreate', message => {
  if (message.author.bot) return;

  const contenido = message.content.toLowerCase();

  if (contenido === '!tirar') {
    contador += 5;
    message.reply(
      `¡BANG! ¡Le diste al mono! +5 puntos (Total: ${contador})`
    );
  }

  const palabrasClave = ['mono', 'banano', 'explosión'];

  if (palabrasClave.some(p => contenido.includes(p))) {
    const respuesta = frasesTropicales[
      Math.floor(Math.random() * frasesTropicales.length)
    ];

    message.channel.send(respuesta);
  }

  if (
    message.attachments.size > 0 ||
    message.content.includes('https://tenor.com')
  ) {
    message.channel.send(
      '¡Qué sabrosura visual! Esto se va directo a los archivos del comando.'
    );
  }
});

client.login(process.env.DISCORD_TOKEN);
