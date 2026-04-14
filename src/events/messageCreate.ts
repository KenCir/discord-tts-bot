import process from 'node:process';
import { Events, MessageFlags } from 'discord.js';
import type { Event } from './index.js';

export default {
	name: Events.MessageCreate,
	async execute(message) {
		if (
			!message.inGuild() ||
			message.system ||
			message.flags.has(MessageFlags.SuppressNotifications) ||
			message.author.bot ||
			(message.client.config.isMaintenance && message.author.id !== process.env.OWNER_ID)
		)
			return;

		const voiceConnection = message.client.voiceConnectionManagers.get(message.guildId);
		if (voiceConnection?.channel.id !== message.channelId) return;

		let text = '';
		if (message.content.length < 1 && message.attachments.size >= 1) {
			const imageFileCount = message.attachments.filter((attachment) =>
				attachment.contentType?.startsWith('image'),
			).size;
			const audioFileCount = message.attachments.filter((attachment) =>
				attachment.contentType?.startsWith('audio'),
			).size;
			const videoFileCount = message.attachments.filter((attachment) =>
				attachment.contentType?.startsWith('video'),
			).size;
			const otherFileCount = message.attachments.size - imageFileCount - audioFileCount - videoFileCount;
			if (imageFileCount > 0) {
				text += `画像が${imageFileCount}個、`;
			}

			if (audioFileCount > 0) {
				text += `オーディオが${audioFileCount}個、`;
			}

			if (videoFileCount > 0) {
				text += `動画が${videoFileCount}個、`;
			}

			if (otherFileCount > 0) {
				text += `ファイルが${otherFileCount}個、`;
			}

			text += '送信されました';
		} else if (message.poll) {
			text = `投票、${message.poll.question.text}が作成されました`;
		} else if (message.flags.has(MessageFlags.HasSnapshot)) {
			text = '転送されたメッセージです';
		} else {
			text = message.cleanContent;

			if (message.mentions.repliedUser) {
				text = `リプライ、` + text;
			}
		}

		const result = await voiceConnection.addQueueText(text);
		if (!result) {
			await message.react('⚠️');
		}
	},
} satisfies Event<Events.MessageCreate>;
