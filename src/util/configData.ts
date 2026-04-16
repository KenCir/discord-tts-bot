import { access, constants, copyFile, readFile } from 'node:fs/promises';
import { z } from 'zod';
import pkg from '../../package.json' with { type: 'json' };
import { logger } from './logger.js';

export const ConfigDataSchema = z.object({
	/**
	 * お知らせメッセージ
	 */
	announcement: z.string().nullable(),

	/**
	 * メンテナンスモードかどうか
	 */
	isMaintenance: z.boolean(),

	/**
	 * アップデート情報
	 */
	updateInfo: z.string().nullable(),

	/**
	 * メンテナンス中のメッセージ
	 */
	maintenanceInfo: z.string().nullable(),
});

export type ConfigData = z.infer<typeof ConfigDataSchema>;

export class Config {
	private configData: ConfigData;

	public constructor() {
		this.configData = {
			announcement: null,
			isMaintenance: false,
			updateInfo: null,
			maintenanceInfo: null,
		};
	}

	public async load(): Promise<void> {
		const configUrl = new URL('../../data/config.json', import.meta.url);
		const exampleUrl = new URL('../../data/config.example.json', import.meta.url);
		const hasConfig = await access(configUrl, constants.R_OK)
			.then(() => true)
			.catch(() => false);

		if (!hasConfig) {
			const hasExample = await access(exampleUrl, constants.R_OK)
				.then(() => true)
				.catch(() => false);

			if (!hasExample) {
				logger.warn('config.json、config.example.jsonが見つかりませんでした。デフォルト設定で起動します。');
				return;
			}

			logger.warn('config.jsonが見つかりませんでした。exampleをコピーして作成します。');
			await copyFile(exampleUrl, configUrl);
		}

		const rawConfig = await readFile(configUrl, 'utf8');
		try {
			this.configData = ConfigDataSchema.parse(JSON.parse(rawConfig));
		} catch (error) {
			logger.error(`Failed to parse config.json: ${error}`);
		}
	}

	public get data(): ConfigData {
		return this.configData;
	}

	public get version(): string {
		return pkg.version;
	}

	public get isMaintenance(): boolean {
		return this.configData.isMaintenance;
	}

	public get announcement(): string {
		return this.configData.announcement ?? 'お知らせはありません';
	}

	public get updateInfo(): string {
		return this.configData.updateInfo ?? 'アップデート情報はありません';
	}

	public get maintenanceInfo(): string {
		return this.configData.maintenanceInfo ?? 'メンテナンス中のメッセージが設定されていません';
	}
}
