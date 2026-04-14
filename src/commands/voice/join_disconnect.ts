import { InteractionContextType } from 'discord.js';
import { JoinResultCode, LeaveResultCode, waitIPCResult } from '../../util/ipc.js';
import { VoiceConnectionManager, VoiceConnectionShutdownCode } from '../../util/voiceConnectionManager.js';
import type { Command } from '../index.js';

export default {
	data: {
		name: 'yomiage',
		description: '読み上げを開始・停止します',
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

		// まず最初に退出処理をする
		// 最初に親機で確認する
		const existingVoiceConnection = interaction.client.voiceConnectionManagers.get(interaction.guildId);
		if (existingVoiceConnection?.channel.id === interaction.channelId) {
			await interaction.followUp('読み上げを停止しています...');
			await existingVoiceConnection.shutdown(VoiceConnectionShutdownCode.Command);
			return;
		}

		// 次に子機で退出処理をする
		for (const childClient of interaction.client.childClients.values()) {
			childClient.send({
				type: 'leave',
				channelId: interaction.channelId,
			});
			const result = await waitIPCResult(childClient, 'leaveResult', interaction.channelId);

			if (result.code === LeaveResultCode.NotConnected)
				continue; // 読み上げを行なってないなら別の子機で試す
			else if (result.code === LeaveResultCode.Success) {
				await interaction.followUp('読み上げを停止しています...');
				return;
			} else {
				await interaction.followUp(`読み上げの停止に失敗しました: ${result.reason}`);
				return;
			}
		}

		// 退出処理が行われなかった場合、読み上げを行なっていないので開始処理をする
		// まず親機が接続されていない場合親機を接続させる
		if (!existingVoiceConnection) {
			const voiceConnection = new VoiceConnectionManager(interaction.channel);
			const errorMessage = voiceConnection.checkJoinable();
			if (errorMessage) {
				await interaction.followUp(`読み上げの開始に失敗しました\n${errorMessage}`);
				return;
			}

			await interaction.followUp('読み上げを開始します...');
			await voiceConnection.joinChannel();

			interaction.client.savedVoiceConnections.add(interaction.channelId);
			return;
		}

		// 次に子機で接続処理をする
		for (const childClient of interaction.client.childClients.values()) {
			childClient.send({
				type: 'join',
				channelId: interaction.channelId,
			});
			const result = await waitIPCResult(childClient, 'joinResult', interaction.channelId);

			if (result.code === JoinResultCode.Success) {
				await interaction.followUp('読み上げを開始します...');

				interaction.client.savedVoiceConnections.add(interaction.channelId);
				return;
			} else if (result.code === JoinResultCode.AlreadyConnected)
				continue; // 別のチャンネルで読み上げを行なっているなら別の子機で試す
			else {
				await interaction.followUp(`読み上げの開始に失敗しました\n${result.reason}`);
				return;
			}
		}

		await interaction.followUp('現在読み上げを行えるBotはありません、時間を空けて再度お試しください');
	},
} satisfies Command;
