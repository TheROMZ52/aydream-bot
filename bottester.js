const mineflayer = require('mineflayer');

const config = {
  host: 'play.aethermc.ir',
  port: 25565,
  username: 'AntiBotTest',
  version: '1.21.11',
  auth: 'offline'
};

// Create bot
console.log('[BOT] Dar hale vasl shodan...');

const bot = mineflayer.createBot(config);

// Login
bot.once('login', () => {
  console.log('[BOT] Ba movafaghiat vared server shod!');
  console.log('[BOT] Username: ' + bot.username);
  console.log('[BOT] Montazer Kick shodan...');
});

// Kick reason
bot.once('kicked', (reason) => {
  console.log('\n[BOT] !!! KICK SHOD !!!');
  console.log('--------------------------------');
  console.log('[BOT] KICK REASON:');

  if (typeof reason === 'string') {
    try {
      console.log(JSON.stringify(JSON.parse(reason), null, 2));
    } catch {
      console.log(reason);
    }
  } else {
    console.log(JSON.stringify(reason, null, 2));
  }

  console.log('--------------------------------');
});

// Errors
bot.on('error', (err) => {
  console.log('[BOT] ERROR: ' + err.message);
});

// Connection closed
bot.once('end', (reason) => {
  console.log('[BOT] Connection ghat shod.');

  if (reason) {
    console.log('[BOT] End reason: ' + reason);
  }
});