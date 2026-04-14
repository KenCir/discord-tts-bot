import type { ChildProcess } from 'node:child_process';
import process from 'node:process';
import { ActivityType, Client, GatewayIntentBits } from 'discord.js';
import { Config } from './util/configData.js';
import { loadEvents } from './util/loaders.js';
import { logger } from './util/logger.js';
import { SavedVoiceConnections } from './util/savedVoiceConnections.js';
import { VoiceConnectionShutdownCode, type VoiceConnectionManager } from './util/voiceConnectionManager.js';

// Initialize the client
const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent,
		GatewayIntentBits.GuildVoiceStates,
		GatewayIntentBits.GuildMembers,
	],
	allowedMentions: {
		parse: [],
		repliedUser: false,
	},
	presence: {
		status: 'online',
		activities: [
			{
				name: 'テキストチャンネルを読み上げ中',
				type: ActivityType.Listening,
			},
		],
	},
});
client.voiceConnectionManagers = new Map<string, VoiceConnectionManager>();
client.childClients = new Map<string, ChildProcess>();
client.config = new Config();
client.savedVoiceConnections = new SavedVoiceConnections();

// Load the events and commands
const events = await loadEvents(new URL('events/', import.meta.url));

// Register the event handlers
for (const event of events) {
	client[event.once ? 'once' : 'on'](event.name, async (...args) => {
		try {
			await event.execute(...args);
		} catch (error) {
			logger.error(error, `Error executing event ${String(event.name)}:`);
		}
	});
}

process.on('unhandledRejection', async (reason, promise) => {
	logger.error(reason, 'Unhandled Rejection at:', promise);
});

const shutdown = async (signal: string) => {
	logger.info(`Shutting down... (${signal})`);

	try {
		for (const voiceConnectionManager of client.voiceConnectionManagers.values()) {
			await voiceConnectionManager.shutdown(VoiceConnectionShutdownCode.ProcessExit);
		}

		await client.savedVoiceConnections.save();
		await client.destroy();
	} catch (error) {
		logger.error(error, 'Shutdown failed');
		process.exitCode = 1;
	}
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

// Login to the client
void client.login(process.env.DISCORD_TOKEN);
