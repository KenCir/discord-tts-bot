import { access, constants, readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { z } from 'zod';
import { logger } from './logger.js';

export const SavedVoiceConnectionsSchema = z.array(z.string());

export type SavedVoiceConnectionsData = z.infer<typeof SavedVoiceConnectionsSchema>;

export class SavedVoiceConnections {
	#voiceConnectionData: SavedVoiceConnectionsData;

	public constructor() {
		this.#voiceConnectionData = [];
	}

	public async load(): Promise<void> {
		try {
			await access(new URL('../../data/voiceConnections.json', import.meta.url), constants.F_OK | constants.R_OK);
		} catch {
			logger.warn('voiceConnections.jsonが見つかりませんでした。');
			return;
		}

		const rawData = await readFile(new URL('../../data/voiceConnections.json', import.meta.url), 'utf8');
		try {
			this.#voiceConnectionData = SavedVoiceConnectionsSchema.parse(JSON.parse(rawData));
		} catch (error) {
			logger.error(`保存されたボイスチャンネルのデータの解析に失敗しました: ${error}`);
		}
	}

	public async save(): Promise<void> {
		// 子プロセスの場合は保存しない
		if (process.env.PROCESS_ROLE === 'child') return;

		await writeFile(
			new URL('../../data/voiceConnections.json', import.meta.url),
			JSON.stringify(this.#voiceConnectionData),
			'utf8',
		);
	}

	public add(channelId: string): void {
		if (!this.#voiceConnectionData.includes(channelId)) {
			this.#voiceConnectionData.push(channelId);
		}
	}

	public remove(channelId: string): void {
		this.#voiceConnectionData = this.#voiceConnectionData.filter((id) => id !== channelId);
	}

	public clear(): void {
		this.#voiceConnectionData = [];
	}

	public get data(): string[] {
		return this.#voiceConnectionData;
	}
}
