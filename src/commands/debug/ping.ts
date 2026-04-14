import type { Command } from '../index.js';

export default {
	data: {
		name: 'ping',
		description: 'Ping!',
	},
	async execute(interaction) {
		await interaction.reply(`Pong!\nLatency is ${interaction.client.ws.ping}ms.`);
	},
} satisfies Command;
