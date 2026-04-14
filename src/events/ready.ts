import { fork } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { getVoiceConnection } from '@discordjs/voice';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { Events } from 'discord.js';
import { JWT } from 'google-auth-library';
import { JoinResultCode, LeaveResultCode, SkipResultCode, waitIPCResult } from '../util/ipc.js';
import type { IPCMessage } from '../util/ipc.js';
import { logger } from '../util/logger.js';
import { VoiceConnectionManager, VoiceConnectionShutdownCode } from '../util/voiceConnectionManager.js';
import type { Event } from './index.js';

export default {
	name: Events.ClientReady,
	once: true,
	async execute(client) {
		logger.info(`Ready! Logged in as ${client.user.tag}`);

		const googleJWTClient = new JWT({
			email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
			key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replaceAll('\\n', '\n'),
			scopes: ['https://www.googleapis.com/auth/cloud-platform'],
		});
		try {
			await googleJWTClient.authorize();
		} catch (error) {
			logger.error(
				{
					err: {
						name: error instanceof Error ? error.name : 'UnknownError',
						message: error instanceof Error ? error.message : String(error),
						code: (error as { code?: unknown })?.code,
						status: (error as { response?: { status?: unknown } })?.response?.status,
					},
				},
				'Googleサービスアカウント認証に失敗しました。環境変数や秘密鍵を確認してください。',
			);
			process.exit(1);
		}

		const textToSpeechClient = new TextToSpeechClient({ authClient: googleJWTClient });
		try {
			await textToSpeechClient.listVoices();
		} catch (error) {
			logger.error(
				{
					err: {
						name: error instanceof Error ? error.name : 'UnknownError',
						message: error instanceof Error ? error.message : String(error),
						code: (error as { code?: unknown })?.code,
						reason: (error as { reason?: unknown })?.reason,
					},
				},
				'Google Text-to-Speech APIへの接続に失敗しました。サービスアカウントの権限やAPIの有効化を確認してください。',
			);
			process.exit(1);
		}

		await client.config.load();
		await client.savedVoiceConnections.load();

		if (process.env.PROCESS_ROLE === 'child') {
			process.on('message', async (message: IPCMessage) => {
				if (!process.send) return;
				if (message.type === 'join') {
					const channel = client.channels.cache.get(message.channelId);
					if (!channel?.isVoiceBased()) {
						process.send({
							type: 'joinResult',
							success: false,
							reason: 'ボイスチャンネルまたはステージチャンネルでこのコマンドを使用してください',
							code: JoinResultCode.NotVoiceChannel,
							channelId: message.channelId,
						});
						return;
					}

					const existingVoiceConnection = client.voiceConnectionManagers.get(channel.guildId);
					if (existingVoiceConnection) {
						process.send({
							type: 'joinResult',
							success: false,
							reason: `既に読み上げを ${existingVoiceConnection.channel} で行なっています`,
							code: JoinResultCode.AlreadyConnected,
							channelId: message.channelId,
						});
						return;
					}

					const voiceConnection = new VoiceConnectionManager(channel, message.reconnect ?? false);
					const errorMessage = voiceConnection.checkJoinable();
					if (errorMessage) {
						process.send({
							type: 'joinResult',
							success: false,
							reason: errorMessage,
							code: JoinResultCode.PermissionError,
							channelId: message.channelId,
						});
						return;
					}

					process.send({
						type: 'joinResult',
						success: true,
						code: JoinResultCode.Success,
						channelId: message.channelId,
					});
					await voiceConnection.joinChannel();
				} else if (message.type === 'leave') {
					const channel = client.channels.cache.get(message.channelId);
					if (!channel?.isVoiceBased()) {
						process.send({
							type: 'leaveResult',
							success: false,
							reason: 'ボイスチャンネルまたはステージチャンネルでこのコマンドを使用してください',
							code: LeaveResultCode.NotVoiceChannel,
							channelId: message.channelId,
						});
						return;
					}

					const voiceConnection = client.voiceConnectionManagers.get(channel.guildId);
					if (voiceConnection?.channel.id !== message.channelId) {
						process.send({
							type: 'leaveResult',
							success: false,
							reason: 'ボイスチャンネルに接続していません',
							code: LeaveResultCode.NotConnected,
							channelId: message.channelId,
						});
						return;
					}

					process.send({
						type: 'leaveResult',
						success: true,
						code: LeaveResultCode.Success,
						channelId: message.channelId,
					});
					await voiceConnection.shutdown(VoiceConnectionShutdownCode.Command);
				} else if (message.type === 'skip') {
					const channel = client.channels.cache.get(message.channelId);
					if (!channel?.isVoiceBased()) {
						process.send({
							type: 'skipResult',
							success: false,
							reason: 'ボイスチャンネルまたはステージチャンネルでこのコマンドを使用してください',
							code: SkipResultCode.NotVoiceChannel,
							channelId: message.channelId,
						});
						return;
					}

					const voiceConnection = client.voiceConnectionManagers.get(channel.guildId);
					if (voiceConnection?.channel.id !== message.channelId) {
						process.send({
							type: 'skipResult',
							success: false,
							reason: 'ボイスチャンネルに接続していません',
							code: SkipResultCode.NotConnected,
							channelId: message.channelId,
						});
						return;
					}

					voiceConnection.skip();
					process.send({
						type: 'skipResult',
						success: true,
						code: SkipResultCode.Success,
						channelId: message.channelId,
					});
				} else if (message.type === 'voiceConnectionStatus') {
					const voiceConnectionsData = [];
					for (const voiceConnectionManager of client.voiceConnectionManagers.values()) {
						const voiceConnection = getVoiceConnection(voiceConnectionManager.channel.guildId);
						if (!voiceConnection) continue;
						voiceConnectionsData.push({
							audioPlayerStatus: voiceConnectionManager.audioPlayerStatus.toString(),
							channelId: voiceConnectionManager.channel.id,
							connectionStatus: voiceConnection.state.status.toString(),
							ping: voiceConnection.ping.ws,
						});
					}

					process.send({
						type: 'voiceConnectionStatusResult',
						displayName: client.user.displayName,
						ping: client.ws.ping,
						memoryUsage: process.memoryUsage().rss,
						voiceConnections: voiceConnectionsData,
					});
				} else if (message.type === 'dictionaryReload') {
					for (const voiceConnectionManager of client.voiceConnectionManagers.values()) {
						await voiceConnectionManager.reloadDictionary();
					}
				} else if (message.type === 'configReload') {
					await client.config.load();
				}
			});

			process.send?.({
				type: 'childReady',
			});
		} else {
			const voiceConnectedChannelIds = client.savedVoiceConnections.data;
			client.savedVoiceConnections.clear();

			for (let index = 1; index <= Number(process.env.CHILD_CLIENTS_COUNT ?? 0); index++) {
				const child = fork(path.join(path.dirname(fileURLToPath(import.meta.url)), '../index.js'), {
					env: {
						...process.env,
						DISCORD_TOKEN: process.env[`CHILD_${index}_DISCORD_TOKEN`],
						LOGGER_NAME: process.env[`CHILD_${index}_NAME`],
						PROCESS_ROLE: 'child',
					},
				});

				child.on('message', async (message: IPCMessage) => {
					if (message.type === 'childReady') {
						client.childClients.set(process.env[`CHILD_${index}_NAME`]!, child);

						const voiceConnectionChannelId = voiceConnectedChannelIds.shift();
						if (!voiceConnectionChannelId) return;

						child.send({
							type: 'join',
							channelId: voiceConnectionChannelId,
							reconnect: true,
						});
						const result = await waitIPCResult(child, 'joinResult', voiceConnectionChannelId);
						if (result.code === JoinResultCode.Success) {
							client.savedVoiceConnections.add(voiceConnectionChannelId);
						}
					} else if (message.type === 'disconnect') {
						client.savedVoiceConnections.remove(message.channelId);
					}
				});
			}

			const voiceConnectionChannelId = voiceConnectedChannelIds.shift();
			if (!voiceConnectionChannelId) return;

			const channel = client.channels.cache.get(voiceConnectionChannelId);
			if (!channel?.isVoiceBased()) {
				logger.error(
					`保存されたチャンネルID ${voiceConnectionChannelId} はボイスチャンネルまたはステージチャンネルではありません`,
				);
				return;
			}

			const voiceConnection = new VoiceConnectionManager(channel, true);
			const errorMessage = voiceConnection.checkJoinable();
			if (errorMessage) return;

			await voiceConnection.joinChannel();
			client.savedVoiceConnections.add(voiceConnectionChannelId);
		}
	},
} satisfies Event<Events.ClientReady>;
