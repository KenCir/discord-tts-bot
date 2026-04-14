import process from 'node:process';
import { Events } from 'discord.js';
import { loadCommands } from '../util/loaders.js';
import type { Event } from './index.js';

const commands = await loadCommands(new URL('../commands/', import.meta.url));

export default {
	name: Events.InteractionCreate,
	async execute(interaction) {
		if (interaction.isCommand()) {
			const command = commands.get(interaction.commandName);

			if (!command) {
				throw new Error(`Command '${interaction.commandName}' not found.`);
			}

			if (interaction.client.config.isMaintenance && interaction.user.id !== process.env.OWNER_ID) {
				await interaction.reply(
					`現在メンテナンス中のため、使用できません\n${interaction.client.config.maintenanceInfo}`,
				);
				return;
			}

			await command.execute(interaction);
		}
	},
} satisfies Event<Events.InteractionCreate>;
