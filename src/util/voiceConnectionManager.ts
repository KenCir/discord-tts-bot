import { Buffer } from 'node:buffer';
import process from 'node:process';
import { Readable } from 'node:stream';
import type { AudioPlayer, AudioResource, VoiceConnectionState } from '@discordjs/voice';
import {
	AudioPlayerStatus,
	createAudioPlayer,
	createAudioResource,
	generateDependencyReport,
	getVoiceConnection,
	joinVoiceChannel,
	VoiceConnectionDisconnectReason,
	VoiceConnectionStatus,
} from '@discordjs/voice';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { ChannelType, EmbedBuilder } from 'discord.js';
import type { StageChannel, VoiceChannel } from 'discord.js';
import { JWT } from 'google-auth-library';
import { Dictionary } from './dictionaryData.js';
import { logger } from './logger.js';

export const VoiceConnectionShutdownCode = {
	Command: 0,
	ForcedDisconnect: 1,
	RateLimited: 2,
	VoiceChannelDelete: 3,
	AllMembersDisconnected: 4,
	ProcessExit: 5,
} as const;
export type VoiceConnectionShutdownCode =
	(typeof VoiceConnectionShutdownCode)[keyof typeof VoiceConnectionShutdownCode];

export class VoiceConnectionManager {
	private readonly audioPlayer: AudioPlayer;

	private isReady: boolean = false;

	private isShutdown: boolean = false;

	private queue: AudioResource[] = [];

	/**
	 * デフォルト辞書
	 */
	private readonly defaultDictionary: Dictionary;

	/**
	 * サーバー辞書
	 */
	private readonly guildDictionary: Dictionary;

	private textToSpeechClient: TextToSpeechClient | null = null;

	public constructor(
		public readonly channel: StageChannel | VoiceChannel,
		private isReconnect: boolean = false,
	) {
		this.audioPlayer = createAudioPlayer({ debug: process.env.NODE_ENV === 'development' });
		this.defaultDictionary = new Dictionary('default');
		this.guildDictionary = new Dictionary(channel.guildId);
	}

	public checkJoinable(): string | null {
		if (
			!this.channel.viewable ||
			!this.channel.joinable ||
			(this.channel.type === ChannelType.GuildVoice && !this.channel.speakable) ||
			(this.channel.type === ChannelType.GuildStageVoice && !this.channel.manageable)
		) {
			let msg = 'VCに接続できません\nBOTに以下の権限が付与されているか確認してください\n\n';
			msg += `チャンネルを見る：${this.channel.viewable ? '✅' : '❌'}\n`;
			msg += `接続：${this.channel.joinable ? '✅' : '❌'}\n`;

			if (this.channel.type === ChannelType.GuildVoice) {
				msg += `発言：${this.channel.speakable ? '✅' : '❌'}\n`;
			} else if (this.channel.type === ChannelType.GuildStageVoice) {
				msg += `管理：${this.channel.manageable ? '✅' : '❌'}\n`;
			}

			return msg;
		}

		return null;
	}

	public async joinChannel(): Promise<void> {
		const googleJWTClient = new JWT({
			email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
			key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replaceAll('\\n', '\n'),
			scopes: ['https://www.googleapis.com/auth/cloud-platform'],
		});
		await googleJWTClient.authorize();
		this.textToSpeechClient = new TextToSpeechClient({ authClient: googleJWTClient });

		const connection = joinVoiceChannel({
			channelId: this.channel.id,
			guildId: this.channel.guildId,
			adapterCreator: this.channel.guild.voiceAdapterCreator,
			debug: process.env.NODE_ENV === 'development',
		});
		connection.subscribe(this.audioPlayer);

		connection.on('stateChange', this.onConnectionStateChange.bind(this));
		connection.on('debug', logger.debug.bind(logger));
		connection.on('error', this.onError.bind(this));
		this.audioPlayer.on(AudioPlayerStatus.Idle, this.onIdle.bind(this));
		this.audioPlayer.on('debug', logger.debug.bind(logger));
		this.audioPlayer.on('error', this.onError.bind(this));

		this.channel.client.voiceConnectionManagers.set(this.channel.guildId, this);
		logger.debug(generateDependencyReport());
	}

	private async onError(error: Error): Promise<void> {
		logger.error(error, 'Voice connection error occurred');
		await this.channel.send(`読み上げ中にエラーが発生しました\n${error.name}: ${error.message}`);
	}

	private async onConnectionStateChange(_: VoiceConnectionState, newState: VoiceConnectionState): Promise<void> {
		if (newState.status === VoiceConnectionStatus.Ready && !this.isReady) {
			// 先に辞書を読み込む
			await this.defaultDictionary.load();
			await this.guildDictionary.load();

			this.isReady = true;

			if (this.isReconnect) {
				await this.addQueueText('再接続しました。');
			} else {
				await this.addQueueText('接続しました。');
			}

			await this.channel.send({
				embeds: [
					new EmbedBuilder()
						.setTitle(`VCに${this.isReconnect ? '再接続' : '接続'}しました！`)
						.setDescription(`${this.channel}で読み上げを開始しました！`)
						.addFields(
							{
								name: 'お知らせ',
								value: this.channel.client.config.announcement,
							},
							{
								name: 'アップデート情報！',
								value: this.channel.client.config.updateInfo,
							},
						)
						.setColor('Green'),
				],
			});
		} else if (
			newState.status === VoiceConnectionStatus.Disconnected &&
			newState.reason === VoiceConnectionDisconnectReason.WebSocketClose
		) {
			if (newState.closeCode === 4_014) {
				// 個々のクライアントを切断します（キックされた、メインゲートウェイセッションが切断されたなど）。
				await this.shutdown(VoiceConnectionShutdownCode.ForcedDisconnect);
			} else if (newState.closeCode === 4_021) {
				// レート制限を超えたため切断されました。
				await this.shutdown(VoiceConnectionShutdownCode.RateLimited);
			} else if (newState.closeCode === 4_022) {
				// 通話が終了したため（チャネルの削除、音声サーバーの変更など）、すべてのクライアントを切断します。
				await this.shutdown(VoiceConnectionShutdownCode.VoiceChannelDelete);
			} else {
				const connection = getVoiceConnection(this.channel.guildId)!;
				connection.rejoin();
				await this.channel.send('接続が切断されました、再接続を試みています...');
			}
		}
	}

	private async onIdle(): Promise<void> {
		if (!this.isReady) return;

		if (this.isShutdown) {
			await this.channel.send('読み上げを終了しました');
			this.cleanUp();
			return;
		}

		const nextResource = this.queue.shift();
		if (nextResource) {
			this.audioPlayer.play(nextResource);
		}
	}

	private cleanUp(): void {
		const connection = getVoiceConnection(this.channel.guildId)!;
		this.queue = [];
		this.audioPlayer.stop();
		this.audioPlayer.removeAllListeners();
		connection.destroy();
		connection.removeAllListeners();
		this.channel.client.voiceConnectionManagers.delete(this.channel.guildId);
	}

	public async shutdown(code: VoiceConnectionShutdownCode): Promise<void> {
		if (!this.isReady) throw new Error('VoiceConnectionManager is not ready');
		if (this.isShutdown) return;

		if (code !== VoiceConnectionShutdownCode.ProcessExit) {
			if (process.env.PROCESS_ROLE === 'child') {
				process.send?.({
					type: 'disconnect',
					channelId: this.channel.id,
				});
			} else {
				this.channel.client.savedVoiceConnections.remove(this.channel.id);
			}
		}

		if (code === VoiceConnectionShutdownCode.Command) {
			this.isShutdown = true;
			return;
		} else if (code === VoiceConnectionShutdownCode.ProcessExit) {
			await this.channel.send(
				'プロセスが終了されたため、読み上げを終了しました\n自動で再接続を行うため、しばらくお待ちください',
			);
		} else if (code === VoiceConnectionShutdownCode.ForcedDisconnect) {
			await this.channel.send('VCから強制切断されたため、読み上げを終了しました');
		} else if (code === VoiceConnectionShutdownCode.AllMembersDisconnected) {
			await this.channel.send('VCに誰もいないため、読み上げを終了しました');
		} else if (code === VoiceConnectionShutdownCode.RateLimited) {
			await this.channel.send(
				'レート制限を超過したため、読み上げを終了しました\n再接続を行う場合は、しばらく時間を空けてからコマンドを実行してください',
			);
		}

		this.cleanUp();
	}

	public async addQueueText(text: string): Promise<boolean> {
		if (!this.isReady || this.isShutdown) return false;

		let replacedText = text;
		for (const [key, value] of Object.entries(this.defaultDictionary.data.data)) {
			const regex = new RegExp(key, value.flags);
			replacedText = replacedText.replace(regex, value.replace);
		}

		for (const [key, value] of Object.entries(this.guildDictionary.data.data)) {
			if (value.isRegExp) {
				const regex = new RegExp(key, value.flags);
				replacedText = replacedText.replace(regex, value.replace);
			} else {
				replacedText = replacedText.replaceAll(key, value.replace);
			}
		}

		try {
			if (!this.textToSpeechClient) {
				throw new Error('Google Cloud Text-to-Speech client is not initialized');
			}

			const [response] = await this.textToSpeechClient.synthesizeSpeech({
				input: {
					text: replacedText,
				},
				voice: {
					languageCode: 'ja-JP',
					name: 'ja-JP-Wavenet-A',
				},
				audioConfig: {
					audioEncoding: 'OGG_OPUS',
					sampleRateHertz: 48_000,
				},
			});

			if (!response.audioContent) throw new Error('No audio content received from Text-to-Speech API');
			const stream = Readable.from([Buffer.from(response.audioContent)]);
			const resource = createAudioResource(stream);
			if (this.audioPlayer.state.status === AudioPlayerStatus.Idle && this.queue.length === 0) {
				this.audioPlayer.play(resource);
			} else {
				this.queue.push(resource);
			}

			return true;
		} catch (error) {
			logger.error(error, 'Failed to fetch TTS audio from Google Cloud Text-to-Speech API');

			return false;
		}
	}

	public skip(): void {
		this.audioPlayer.stop();
	}

	public async reloadDictionary(): Promise<void> {
		await this.guildDictionary.load();
	}

	public get audioPlayerStatus(): AudioPlayerStatus {
		return this.audioPlayer.state.status;
	}
}
