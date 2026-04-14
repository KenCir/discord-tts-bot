import { Events } from 'discord.js';
import { VoiceConnectionShutdownCode } from '../util/voiceConnectionManager.js';
import type { Event } from './index.js';

export default {
	name: Events.VoiceStateUpdate,
	async execute(oldState, newState) {
		const voiceConnection = newState.client.voiceConnectionManagers.get(newState.guild.id);
		if (!voiceConnection) return;

		// Bot以外のユーザーが全員退出した場合
		if (
			oldState.channel?.id === voiceConnection.channel.id &&
			oldState.channel?.members.filter((member) => !member.user.bot).size === 0
		) {
			await voiceConnection.shutdown(VoiceConnectionShutdownCode.AllMembersDisconnected);
			return;
		}

		const oldMember = oldState.member ?? (await oldState.guild.members.fetch(oldState.id).catch(() => null));
		const newMember = newState.member ?? (await newState.guild.members.fetch(newState.id).catch(() => null));
		if (
			oldState.client.config.isMaintenance ||
			oldMember?.id === oldState.client.user.id ||
			newMember?.id === newState.client.user.id
		)
			return;
		if (oldState.channelId !== newState.channelId) {
			if (newState.channelId === voiceConnection.channel.id) {
				await voiceConnection.addQueueText(`${newMember?.displayName} さんが参加しました`);
			} else if (oldState.channelId === voiceConnection.channel.id) {
				await voiceConnection.addQueueText(`${oldMember?.displayName} さんが退出しました`);
			}
		}
	},
} satisfies Event<Events.VoiceStateUpdate>;
