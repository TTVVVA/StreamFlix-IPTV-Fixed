require('dotenv').config({ path: './keiken-player/.env' });
const { Client, GatewayIntentBits, Events } = require('discord.js');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.once(Events.ClientReady, c => {
    console.log(`Bot de Teste pronto! Logado como ${c.user.tag}`);
    console.log('Usa /testar no Discord para abrir a nova Activity.');
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'testar') {
        try {
            await interaction.launchActivity();
            await interaction.reply({ content: 'A abrir a NOVA Activity...', ephemeral: true });
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: `Erro ao abrir Activity: ${error.message}`, ephemeral: true });
        }
    }
});

// Nota: Precisas de registar este comando /testar no teu bot de testes
client.login(process.env.DISCORD_TOKEN);
