import { InteractionContextType } from 'discord.js';
import { SkipResultCode, waitIPCResult } from '../../util/ipc.js';
import type { Command } from '../index.js';

export default {
	data: {
		name: 'skip',
		description: '再生中のメッセージの読み上げをスキップします',
		contexts: [InteractionContextType.Guild],
	},
	async execute(interaction) {
		if (!interaction.inCachedGuild()) {
			await interaction.reply('このコマンドはDMで使用できません');
			return;
		}

		if (!interaction.channel?.isVoiceBased()) {
			await interaction.reply('ボイスチャンネルまたはステージチャンネルでこのコマンドを使用してください');
			return;
		}

		if (interaction.member.voice.channelId !== interaction.channelId) {
			await interaction.reply('ボイスチャンネルに参加してからこのコマンドを使用してください');
			return;
		}

		await interaction.deferReply();

		// まず子機から走査を行う
		for (const childClient of interaction.client.childClients.values()) {
			childClient.send({
				type: 'skip',
				channelId: interaction.channelId,
			});
			const result = await waitIPCResult(childClient, 'skipResult', interaction.channelId);

			if (result.code === SkipResultCode.NotConnected)
				continue; // 読み上げを行なってないなら別の子機で試す
			else if (result.code === SkipResultCode.Success) {
				await interaction.followUp('スキップしました！');
				return;
			}
		}

		const voiceConnection = interaction.client.voiceConnectionManagers.get(interaction.guildId);
		if (voiceConnection?.channel.id !== interaction.channelId) {
			await interaction.followUp('このチャンネルで読み上げを行なっていません');
			return;
		}

		voiceConnection.skip();
		await interaction.followUp('スキップしました！');
	},
} satisfies Command;
