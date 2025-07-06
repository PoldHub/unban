// index.js
// Gestione login Discord, verifica ban, richieste unban, interazione bot Discord e blacklist temporanea

require('dotenv').config();
// Import principali
const express = require('express');
const session = require('express-session');
const fetch = require('node-fetch');
const bodyParser = require('body-parser');
const path = require('path');
const { Client, GatewayIntentBits, Partials, ButtonBuilder, ButtonStyle, ActionRowBuilder, Events, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const fs = require('fs');
const { REST } = require('@discordjs/rest');

// Variabili di configurazione ambiente
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const CALLBACK_URL = process.env.CALLBACK_URL;
const GUILD_ID = process.env.GUILD_ID;
const BOT_TOKEN = process.env.BOT_TOKEN;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const PORT = 3000;
const BLACKLIST_FILE = './blacklist.json';
const MOD_ROLE_ID = process.env.MOD_ROLE_ID;
const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID;
const NOTIFY_GUILD_ID = process.env.NOTIFY_GUILD_ID;

// Funzioni per la gestione della blacklist temporanea degli utenti
function loadBlacklist() {
  if (!fs.existsSync(BLACKLIST_FILE)) return {};
  return JSON.parse(fs.readFileSync(BLACKLIST_FILE));
}
function saveBlacklist(blacklist) {
  fs.writeFileSync(BLACKLIST_FILE, JSON.stringify(blacklist));
}
function isBlacklisted(userId) {
  const blacklist = loadBlacklist();
  if (!blacklist[userId]) return false;
  const expires = blacklist[userId];
  if (Date.now() > expires) {
    delete blacklist[userId];
    saveBlacklist(blacklist);
    return false;
  }
  return expires;
}
function addBlacklist(userId) {
  const blacklist = loadBlacklist();
  blacklist[userId] = Date.now() + 7 * 24 * 60 * 60 * 1000;
  saveBlacklist(blacklist);
}

// Inizializzazione del bot Discord
const bot = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages // <-- Aggiunto per ricevere i DM
  ],
  partials: [Partials.User, Partials.GuildMember, Partials.Channel] // <-- Aggiunto Partials.Channel per i canali DM
});
bot.login(BOT_TOKEN);

bot.on('ready', () => {
  console.log('Bot Discord pronto!');
});

// Inizializzazione app Express e middleware
const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({ secret: 'poldban', resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());

// Configurazione autenticazione Discord con Passport
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));
passport.use(new DiscordStrategy({
  clientID: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  callbackURL: CALLBACK_URL,
  scope: ['identify']
}, (accessToken, refreshToken, profile, done) => {
  process.nextTick(() => done(null, profile));
}));

// Utility: verifica se l'utente è bannato
async function isUserBanned(userId) {
  try {
    const guild = await bot.guilds.fetch(GUILD_ID);
    const bans = await guild.bans.fetch();
    return bans.get(userId) || null;
  } catch (e) {
    return null;
  }
}

// Utility: recupera timestamp del ban
async function getBanTimestamp(userId) {
  try {
    const guild = await bot.guilds.fetch(GUILD_ID);
    const bans = await guild.bans.fetch();
    const ban = bans.get(userId);
    return ban?.createdTimestamp || Date.now();
  } catch (e) {
    return Date.now();
  }
}

// Utility: invio DM tramite bot
async function sendDM(userId, message) {
  try {
    const user = await bot.users.fetch(userId);
    await user.send(message);
    return true;
  } catch (err) {
    console.error('Invio DM fallito:', err.message);
    return false;
  }
}

// ====== ROUTES ======
app.get('/', async (req, res) => {
  let html = '';
  html += '<html><head><title>🔨 BansPoldiani</title>';
  html += '<meta name="viewport" content="width=device-width, initial-scale=1">';
  html += '<style>';
  html += 'body { background: #23272a; color: #fff; font-family: \'Segoe UI\', Arial, sans-serif; margin: 0; }';
  html += '.container { min-height: 100vh; display: flex; align-items: center; justify-content: center; }';
  html += '.card { background: #2c2f33; border-radius: 16px; box-shadow: 0 4px 32px #000a; padding: 40px 32px; max-width: 420px; width: 100%; text-align: center; }';
  html += 'h1 { color: #7289da; font-size: 2.2em; margin-bottom: 0.2em; }';
  html += 'h2 { color: #43b581; margin-top: 0.2em; }';
  html += '.btn { background: #7289da; color: #fff; border: none; border-radius: 8px; padding: 14px 32px; font-size: 1.1em; font-weight: 600; margin: 16px 0; cursor: pointer; transition: background 0.2s; text-decoration: none; display: inline-block; }';
  html += '.btn:hover { background: #5865f2; }';
  html += '.input, textarea { width: 100%; border-radius: 8px; border: none; padding: 12px; margin: 12px 0 20px 0; background: #23272a; color: #fff; font-size: 1em; }';
  html += '.input:focus, textarea:focus { outline: 2px solid #7289da; }';
  html += '.info { color: #b9bbbe; font-size: 0.98em; margin-bottom: 10px; }';
  html += '.status { font-size: 1.1em; margin: 18px 0; }';
  html += '.error { color: #ed4245; font-weight: bold; }';
  html += '.success { color: #43b581; font-weight: bold; }';
  html += '@media (max-width: 600px) { .card { padding: 24px 6vw; } }';
  html += '</style></head><body><div class="container"><div class="card">';
  html += '<h1>🔨 BansPoldiani</h1>';
  if (!req.user) {
    html += '<div class="info">🔐 Accedi con Discord per inviare una richiesta di unban.</div>';
    html += '<a href="/login" class="btn">🔗 Login con Discord</a>';
  } else {
    const userId = req.user.id;
    const username = req.user.username + '#' + req.user.discriminator;
    const blacklistUntil = isBlacklisted(userId);
    if (blacklistUntil) {
      const msLeft = blacklistUntil - Date.now();
      const days = Math.floor(msLeft / (1000*60*60*24));
      const hours = Math.floor((msLeft % (1000*60*60*24)) / (1000*60*60));
      const minutes = Math.floor((msLeft % (1000*60*60)) / (1000*60));
      html += '<h2>⚠️ Blacklist</h2>';
      html += '<div class="error">🚫 Sei in blacklist per una settimana!</div>';
      html += '<div class="info">⏰ Riprova tra: <b>' + days + ' giorni, ' + hours + ' ore, ' + minutes + ' minuti</b></div>';
    } else {
      html += '<div class="info">👋 Ciao <b>' + username + '</b>!</div>';
      html += '<form method="POST" action="/logout" style="margin-bottom:18px;"><button class="btn" style="background:#ed4245;">🚪 Logout</button></form>';
      // Stato ban
      const ban = await isUserBanned(userId);
      if (!ban) {
        html += '<div class="success">✅ Non sei bannato dal server! <br>[se ti vuoi far bannare non ti ferma nessuno]</div>';
      } else {
        // Qui puoi aggiungere logica per "waiting" se vuoi salvare richieste in un DB/file
        html += '<h2>📝 Richiesta di unban</h2>';
        html += '<form method="POST" action="/unban-request">';
        html += '<textarea name="message" placeholder="💬 Motivazione della richiesta (spiega perché dovresti essere sbannato)" required></textarea>';
        html += '<button type="submit" class="btn">📤 Invia richiesta</button>';
        html += '</form>';
      }
    }
  }
  html += '</div></div></body></html>';
  res.send(html);
});

// API per stato utente (ban, richiesta inviata, ecc)
app.get('/api/status', async (req, res) => {
  if (!req.user) return res.json({ status: 'nologin' });
  const userId = req.user.id;
  if (isBlacklisted(userId)) return res.json({ status: 'blacklist' });
  // Qui puoi aggiungere logica per "waiting" se vuoi salvare richieste in un DB/file
  const ban = await isUserBanned(userId);
  if (!ban) return res.json({ status: 'notbanned' });
  // Se vuoi, qui puoi controllare se la richiesta è già stata inviata e non mostrare il form
  res.json({ status: 'banned' });
});

app.get('/login', passport.authenticate('discord'));
app.get('/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => {
  res.redirect('/');
});

// ====== LOGOUT ROUTE ======
app.post('/logout', (req, res) => {
  req.logout((err) => {
    if (err) return res.redirect('/');
    res.redirect('/');
  });
});

// ====== INVIO EMBED PER LE RICHIESTE UNBAN (STILE ORIGINALE, UN SOLO MESSAGGIO) ======
function sendUnbanEmbedUnificato(channel, username, userId, banTimestamp, message, yesVotes = 0, noVotes = 0, risposta = null, motivoBan = null) {
  async function getBanInfo() {
    try {
      const guild = await bot.guilds.fetch(GUILD_ID);
      const ban = await guild.bans.fetch(userId);
      return {
        motivo: ban.reason || 'Nessun motivo fornito',
        exists: true
      };
    } catch (e) {
      return {
        motivo: 'Nessun motivo fornito',
        exists: false
      };
    }
  } 

  (async () => {
    const banInfo = await getBanInfo();
    const motivo = motivoBan && motivoBan.trim() ? motivoBan : banInfo.motivo;
    const embed = {
      color: 0x7289da,
      title: '📝 Nuova richiesta di unban',
      fields: [
        { name: '👤 Utente', value: `${username} [${userId}]`, inline: false },
        { name: '📑 Motivo', value: motivo, inline: false },
        { name: '💬 Messaggio', value: message, inline: false },
        { name: '📢 Risposta', value: risposta && risposta.trim() ? risposta : 'risposta ancora non fornita', inline: false }
      ]
    };
    // Prima riga bottoni: accetta/rifiuta/rispondi
    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`accept_${userId}`).setLabel('✅ Accetta').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`deny_${userId}`).setLabel('❌ Rifiuta').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`comment_${userId}`).setLabel('💬 Rispondi').setStyle(ButtonStyle.Secondary)
    );
    // Seconda riga: testo + bottoni affiancati
    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('dummy')
        .setLabel('🗳️ È ingiusto il ban?')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder().setCustomId(`vote_yes_${userId}`).setLabel(`👍 ${yesVotes}`).setStyle(ButtonStyle.Primary).setDisabled(false),
      new ButtonBuilder().setCustomId(`vote_no_${userId}`).setLabel(`👎 ${noVotes}`).setStyle(ButtonStyle.Secondary).setDisabled(false)
    );
    channel.send({ embeds: [embed], components: [row1, row2] });
  })();
}

// ====== STORAGE VOTAZIONI E COMMENTI ======
const votes = {}; // { requestId: { yes: [], no: [] } }
const comments = {}; // { requestId: "commento" }
const processedUsers = new Set(); // Per evitare doppi messaggi

// ====== ROUTE UNBAN REQUEST ======
app.post('/unban-request', (req, res) => {
  if (!req.user) return res.redirect('/');
  const userId = req.user.id;
  const username = req.user.username + '#' + req.user.discriminator;
  const message = req.body.message;
  getBanTimestamp(userId).then(banTimestamp => {
    addBlacklist(userId);
    const channel = bot.channels.cache.get(LOG_CHANNEL_ID);
    if (channel) {
      sendUnbanEmbedUnificato(channel, username, userId, banTimestamp, message);
    }
    res.send(`
      <html><head><title>📨 BansPoldiani</title><style>
      body { background:#23272a; color:#fff; font-family:sans-serif; }
      .center { display:flex;align-items:center;justify-content:center;height:100vh; }
      .box { background:#2c2f33; border-radius:12px; padding:40px 30px; box-shadow:0 2px 16px #0008; max-width:420px; width:100%; text-align:center; }
      .box h2 { color:#43b581; }
      .box a { background:#43b581; color:white; padding:12px 32px; border-radius:8px; font-size:1.1em; text-decoration:none; border:none; margin:10px 0; display:inline-block; transition:background 0.2s; }
      .box a:hover { background:#7289da; }
      .box small { color:#b9bbbe; }
      </style></head><body><div class="center"><div class="box">
        <h2>✅ Richiesta inviata!</h2>
        <p>📨 Per ricevere la notifica di risposta entra nel server Discord qui sotto:</p>
        <a href="https://discord.com/invite/eYd2Myj7FQ" target="_blank">🔗 Entra nel Discord per la conferma</a>
        <br><br>
        <small>⚠️ Assicurati di non avere i DM bloccati dai bot.<br>🔔 Il bot ti notificherà appena la tua richiesta verrà gestita.</small>
      </div></div></body></html>
    `);
  });
});

// ====== JOIN SERVER UNBAN HANDLER ======
app.post('/joined-unban-server', async (req, res) => {
  if (!req.user) return res.redirect('/');
  const userId = req.user.id;
  try {
    const guild = await bot.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) {
      await sendDM(userId, 'Abbiamo ricevuto la tua richiesta di unban! Riceverai qui la risposta appena sarà gestita.');      res.send(`
        <html><head><title>✅ Notifica Discord</title></head><body style=\"display:flex;align-items:center;justify-content:center;height:100vh;background:#23272a;\">
        <div style=\"text-align:center;color:white;max-width:400px;\">
          <h2>🎉 Perfetto!</h2>
          <p>✅ Risulti nel server Discord. Riceverai la notifica direttamente su Discord appena la tua richiesta verrà gestita.</p>
          <a href=\"/\" style=\"color:#7289da;\">🏠 Torna alla home</a>
        </div></body></html>
      `);
    } else {      res.send(`
        <html><head><title>❌ Errore Discord</title></head><body style=\"display:flex;align-items:center;justify-content:center;height:100vh;background:#23272a;\">
        <div style=\"text-align:center;color:white;max-width:400px;\">
          <h2>❌ Non risulti nel server!</h2>
          <p>🔗 Entra prima nel server Discord e poi riprova.</p>
          <a href=\"/\" style=\"color:#7289da;\">🏠 Torna alla home</a>
        </div></body></html>
      `);
    }
  } catch (e) {
    res.send(`<html><head><title>⚠️ Errore</title></head><body style=\"display:flex;align-items:center;justify-content:center;height:100vh;background:#23272a;\"><div style=\"text-align:center;color:white;max-width:400px;\"><h2>⚠️ Errore Discord</h2><p>🔧 Si è verificato un errore nella verifica. Riprova.</p><a href=\"/\" style=\"color:#7289da;\">🏠 Torna alla home</a></div></body></html>`);
  }
});

// ====== BOT BUTTON HANDLER ======
bot.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.customId.startsWith('vote_')) {
    // Gestione votazione
    const [action, vote, userId] = interaction.customId.split('_');
    const voterId = interaction.user.id;
    if (!votes[userId]) votes[userId] = { yes: [], no: [] };
    // Rimuovi voto precedente se esiste
    votes[userId].yes = votes[userId].yes.filter(id => id !== voterId);
    votes[userId].no = votes[userId].no.filter(id => id !== voterId);
    // Aggiungi nuovo voto
    if (vote === 'yes') {
      votes[userId].yes.push(voterId);
    } else {
      votes[userId].no.push(voterId);
    }
    // Prendi l'embed originale
    const originalEmbed = interaction.message.embeds[0].toJSON();
    // Aggiorna solo il campo Motivazione (non serve altro)
    let newFields = originalEmbed.fields.map(f => ({...f}));
    // Ricostruisci embed senza campo Voti
    newFields = newFields.filter(f => f.name !== 'Voti');
    const updatedEmbed = {
      ...originalEmbed,
      fields: newFields
    };
    // Aggiorna la riga dei bottoni (seconda riga, non la prima!)
    const rows = interaction.message.components.map(row => ActionRowBuilder.from(row));
    if (rows[1] && rows[1].components[1] && rows[1].components[2]) {
      rows[1].components[1].setLabel(`👍 ${votes[userId].yes.length}`).setDisabled(false);
      rows[1].components[2].setLabel(`👎 ${votes[userId].no.length}`).setDisabled(false);
    }
    await interaction.update({ embeds: [updatedEmbed], components: rows });
    return;
  }
  
  if (interaction.customId.startsWith('comment_')) {
    // Gestione risposta mod
    const [action, userId] = interaction.customId.split('_');
    const guild = await bot.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !member.roles.cache.has(MOD_ROLE_ID)) {
      return interaction.reply({ content: 'Solo i moderatori possono rispondere.', ephemeral: true });
    }
    // Mostra modal per inserire risposta
    const modal = {
      title: 'Rispondi alla richiesta',
      custom_id: `comment_modal_${userId}`,
      components: [{
        type: 1,
        components: [{
          type: 4,
          custom_id: 'comment_text',
          label: 'Risposta del moderatore',
          style: 2,
          placeholder: 'Scrivi la risposta da mostrare all’utente...',
          required: true,
          max_length: 1000
        }]
      }]
    };
    await interaction.showModal(modal);
    return;
  }
  
  const [action, userId] = interaction.customId.split('_');
  if (!['accept', 'deny'].includes(action)) return;
  // Controllo ruolo mod
  const guild = await bot.guilds.fetch(GUILD_ID);
  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member || !member.roles.cache.has(MOD_ROLE_ID)) {
    return interaction.reply({ content: 'Solo i moderatori possono approvare o rifiutare le richieste.', ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true }); // Risposta solo per il mod
  const user = await bot.users.fetch(userId).catch(() => null);
  let stato = '';
  if (action === 'accept') {
    await guild.members.unban(userId).catch(() => {});
    stato = '✅ **Richiesta accettata e utente sbannato.**';
    if (user) {
      await user.send({
        embeds: [{
          color: 0x43b581,
          title: '✅ Richiesta di unban ACCETTATA',
          description: '🎉 La tua richiesta di unban è stata accettata! Puoi rientrare nel server: https://dsc.gg/poldo',
          footer: { text: '🔨 BansPoldiani' },
          timestamp: new Date().toISOString()
        }]
      });
      // Espulsione dal server notifiche
      if (NOTIFY_GUILD_ID) {
        try {
          const notifyGuild = await bot.guilds.fetch(NOTIFY_GUILD_ID);
          const notifyMember = await notifyGuild.members.fetch(userId).catch(() => null);
          if (notifyMember) await notifyMember.kick('Richiesta di unban accettata');
        } catch (e) {}
      }
    }
  } else {
    stato = '❌ **Richiesta rifiutata.**';
    if (user) {
      const embedFields = [{
        color: 0xed4245,
        title: '❌ Richiesta di unban RIFIUTATA',
        description: '😔 Mi dispiace, la tua richiesta di unban è stata rifiutata.',
        footer: { text: '🔨 BansPoldiani' },
        timestamp: new Date().toISOString()
      }];
      // Aggiungi motivo se presente
      if (comments[userId]) {
        embedFields[0].fields = [{ name: '💭 Motivo del rifiuto', value: comments[userId], inline: false }];
      }
      await user.send({ embeds: embedFields });
      // Espulsione dal server notifiche
      if (NOTIFY_GUILD_ID) {
        try {
          const notifyGuild = await bot.guilds.fetch(NOTIFY_GUILD_ID);
          const notifyMember = await notifyGuild.members.fetch(userId).catch(() => null);
          if (notifyMember) await notifyMember.kick('Richiesta di unban rifiutata');
        } catch (e) {}
      }
    }
  }
  // Modifica il messaggio: aggiungi stato sopra l'embed, rimuovi i bottoni
  await interaction.message.edit({
    content: stato,
    embeds: interaction.message.embeds,
    components: []
  });
  await interaction.editReply({ content: 'Risposta inviata all\'utente.', ephemeral: true });
});

// ====== GESTIONE MODAL COMMENTI ======
bot.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isModalSubmit()) return;
  
  if (interaction.customId.startsWith('comment_modal_')) {
    const userId = interaction.customId.split('_')[2];
    const rispostaText = interaction.fields.getTextInputValue('comment_text');
    // Salva risposta
    comments[userId] = rispostaText;
    // Trova e aggiorna tutti i messaggi di richiesta unban per questo utente
    const channel = bot.channels.cache.get(LOG_CHANNEL_ID);
    if (channel) {
      const messages = await channel.messages.fetch({ limit: 50 });
      // Cerca messaggi con embed di richiesta unban
      const votingMessage = messages.find(msg => {
        if (msg.embeds[0] && msg.embeds[0].title === '📝 Nuova richiesta di unban' &&
            msg.embeds[0].fields && msg.embeds[0].fields[0].value.includes(userId)) {
          return true;
        }
        return false;
      });
      if (votingMessage) {
        // Prendi l'embed originale
        const originalEmbed = votingMessage.embeds[0].toJSON();
        // Aggiorna solo il campo Risposta
        let newFields = originalEmbed.fields.map(f => {
          if (f.name === '📢 Risposta') return { ...f, value: rispostaText };
          return { ...f };
        });
        const updatedEmbed = {
          ...originalEmbed,
          fields: newFields
        };
        // Mantieni i bottoni
        await votingMessage.edit({ embeds: [updatedEmbed], components: votingMessage.components });
      }
    }
    await interaction.reply({ content: '💬 Risposta inviata e aggiornata con successo!', ephemeral: true });
  }
});

// ====== AVVIO SERVER ======
app.listen(PORT, () => {
  console.log(`Server avviato su http://localhost:${PORT}`);
});

// ====== BOT GUILD_MEMBER_ADD HANDLER ======
bot.on('guildMemberAdd', async member => {
  // Invia il DM solo se l'utente entra nella guild delle notifiche
  if (NOTIFY_GUILD_ID && member.guild.id !== NOTIFY_GUILD_ID) return;
  
  const userId = member.id;
  
  // Evita doppi messaggi controllando se l'utente è già stato processato
  if (processedUsers.has(userId)) {
    return;
  }
  
  if (isBlacklisted(userId)) {
    // Aggiungi l'utente al set per evitare doppi messaggi
    processedUsers.add(userId);
    
    // Rimuovi dall'elenco dopo 10 minuti per permettere riprocessamento se necessario
    setTimeout(() => {
      processedUsers.delete(userId);
    }, 10 * 60 * 1000);
    
    // Recupera il vero timestamp del ban
    let banTimestamp = Date.now();
    try {
      const guild = await bot.guilds.fetch(GUILD_ID);
      const bans = await guild.bans.fetch();
      const ban = bans.get(userId);
      if (ban && ban.createdTimestamp) {
        banTimestamp = ban.createdTimestamp;
      }
    } catch (e) {}
      // Embed DM richiesta ricevuta
    await member.send({
      embeds: [{
      color: 0x7289da,
      title: '📨 Richiesta di unban ricevuta',
      description: '✅ Abbiamo ricevuto la tua richiesta di unban. Riceverai qui la risposta appena sarà gestita dai moderatori.',
      footer: { text: '🔨 BansPoldiani' },
      timestamp: new Date().toISOString()
      }]
    }).catch(() => {});
      // Tagga l'utente in un canale e cancella il messaggio dopo 12 ore
    if (WELCOME_CHANNEL_ID) {
      const welcomeChannel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
      if (welcomeChannel) {
        const msg = await welcomeChannel.send({ content: `📨 <@${userId}>, controlla i tuoi messaggi diretti! Se non hai ricevuto la notifica dal bot, assicurati di aver abilitato i messaggi diretti dai membri del server.` });
        setTimeout(() => {
          msg.delete().catch(() => {});
        }, 12 * 60 * 60 * 1000); // 12 ore
      }
    }
  }
});
