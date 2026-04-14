import process from 'node:process';
import { getVoiceConnection } from '@discordjs/voice';
import { EmbedBuilder } from 'discord.js';
import { waitIPCResult } from '../../util/ipc.js';
import type { Command } from '../index.js';

function formatBytes(bytes: number): string {
	if (bytes < 1_024) return `${bytes}B`;
	const kb = bytes / 1_024;
	if (kb < 1_024) return `${kb.toFixed(2)}KB`;
	const mb = kb / 1_024;
	if (mb < 1_024) return `${mb.toFixed(2)}MB`;
	const gb = mb / 1_024;
	return `${gb.toFixed(2)}GB`;
}

export default {
	data: {
		name: 'status',
		description: '読み上げBotの使用状態などを表示します',
	},
	async execute(interaction) {
		await interaction.deferReply();

		const embed = new EmbedBuilder();
		embed.setTitle('読み上げBotの状態');

		embed.addFields({
			name: `${interaction.client.user.displayName}`,
			value: `WebSocketPing: ${interaction.client.ws.ping}ms\nMemory: ${formatBytes(process.memoryUsage().rss)}\n${interaction.client.voiceConnectionManagers.size} VoiceConnections`,
		});
		for (const [guildId, voiceConnectionManager] of interaction.client.voiceConnectionManagers) {
			const voiceConnection = getVoiceConnection(guildId);
			if (!voiceConnection) continue;
			let statusText = '';
			statusText += `VoiceWebSocketPing: ${voiceConnection.ping.ws ?? 'データなし'}ms\n`;
			statusText += `ConnectionStatus: ${voiceConnection.state.status.toString()}\nAudioPlayerStatus: ${voiceConnectionManager.audioPlayerStatus.toString()}\n`;
			statusText += `Channel: ${voiceConnectionManager.channel}(${voiceConnectionManager.channel.id})`;
			embed.addFields({
				name: `${interaction.client.user.displayName} - ${voiceConnectionManager.channel.guild.name}(${voiceConnectionManager.channel.guildId})`,
				value: statusText,
			});
		}

		for (const childClient of interaction.client.childClients.values()) {
			childClient.send({
				type: 'voiceConnectionStatus',
			});
			const result = await waitIPCResult(childClient, 'voiceConnectionStatusResult');

			embed.addFields({
				name: `${result.displayName}`,
				value: `WebSocketPing: ${result.ping}ms\nMemory: ${formatBytes(result.memoryUsage)}\n${result.voiceConnections.length} VoiceConnections`,
			});
			for (const voiceConnectionData of result.voiceConnections) {
				const channel = interaction.client.channels.cache.get(voiceConnectionData.channelId);
				if (!channel?.isVoiceBased()) continue;
				let statusText = '';
				statusText += `VoiceWebSocketPing: ${voiceConnectionData.ping ?? 'データなし'}ms\n`;
				statusText += `ConnectionStatus: ${voiceConnectionData.connectionStatus}\nAudioPlayerStatus: ${voiceConnectionData.audioPlayerStatus}\n`;
				statusText += `Channel: ${channel}(${channel.id})`;
				embed.addFields({
					name: `${result.displayName} - ${channel.guild.name}(${channel.guildId})`,
					value: statusText,
				});
			}
		}

		await interaction.followUp({ embeds: [embed] });
	},
} satisfies Command;
