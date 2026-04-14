import process from 'node:process';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, ComponentType, Events } from 'discord.js';
import { JoinResultCode, waitIPCResult } from '../util/ipc.js';
import { VoiceConnectionManager } from '../util/voiceConnectionManager.js';
import type { Event } from './index.js';

export default {
	name: Events.ChannelCreate,
	async execute(channel) {
		// 子プロセスの場合は処理しない
		if (process.send) return;
		if (
			channel.type !== ChannelType.GuildVoice ||
			channel.parentId !== process.env.VOICE_CATEGORY_ID ||
			channel.client.config.isMaintenance
		)
			return;

		const message = await channel.send({
			content: 'このVCで読み上げを開始しますか？',
			components: [
				new ActionRowBuilder<ButtonBuilder>().addComponents([
					new ButtonBuilder().setCustomId('yes').setLabel('開始する').setStyle(ButtonStyle.Success),
					new ButtonBuilder().setCustomId('no').setLabel('開始しない').setStyle(ButtonStyle.Danger),
				]),
			],
		});

		try {
			const response = await message.awaitMessageComponent({
				// filter,
				componentType: ComponentType.Button,
				time: 60 * 3 * 1_000, // 3分
			});

			if (response.customId === 'yes') {
				await message.edit({
					content: '読み上げを開始します...',
					components: [],
				});

				// eslint-disable-next-line no-warning-comments
				// todo: 既に同一チャンネル読み上げを開始している場合の処理（そんな事する人いないと思うので後回しでいい）
				const existingVoiceConnection = channel.client.voiceConnectionManagers.get(channel.guildId);
				if (!existingVoiceConnection) {
					const voiceConnection = new VoiceConnectionManager(channel);
					await voiceConnection.joinChannel();
					return;
				}

				// 次に子機で接続処理をする
				for (const childClient of channel.client.childClients.values()) {
					childClient.send({
						type: 'join',
						channelId: channel.id,
					});
					const result = await waitIPCResult(childClient, 'joinResult', channel.id);

					if (result.code === JoinResultCode.Success) {
						return;
					} else if (result.code === JoinResultCode.AlreadyConnected)
						continue; // 別のチャンネルで読み上げを行なっているなら別の子機で試す
					else {
						await message.edit(`読み上げの開始に失敗しました\n${result.reason}`);
						return;
					}
				}

				await message.edit('現在読み上げを行えるBotはありません、時間を空けて再度お試しください');
				return;
			}
		} catch {}

		if (message.deletable) {
			await message.delete();
		}
	},
} satisfies Event<Events.ChannelCreate>;
