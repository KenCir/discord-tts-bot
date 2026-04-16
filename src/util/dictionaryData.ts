import { access, constants, readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';

export const DictionaryDataSchema = z.object({
	/**
	 * 辞書データ
	 */
	data: z.record(
		z.string(), // キー（置き換え前の文字列）
		z.object({
			// 正規表現フラグ
			flags: z.string(),
			// 正規表現を使うか
			isRegExp: z.boolean().optional(),
			// 置き換え後の文字列
			replace: z.string(),
		}),
	),

	/**
	 * 辞書のサーバーID(デフォルト辞書の場合0)
	 */
	id: z.string(),
});

export type DictionaryData = z.infer<typeof DictionaryDataSchema>;

export class Dictionary {
	private readonly guildId: string;

	private dictionaryData: DictionaryData;

	public constructor(guildId: string) {
		this.guildId = guildId;
		this.dictionaryData = {
			id: this.guildId,
			data: {},
		};
	}

	public async load(): Promise<void> {
		try {
			await access(
				new URL(`../../data/dictionary/${this.guildId}.json`, import.meta.url),
				constants.F_OK | constants.R_OK | constants.W_OK,
			);
		} catch {
			return;
		}

		const rawData = await readFile(new URL(`../../data/dictionary/${this.guildId}.json`, import.meta.url), 'utf8');
		try {
			this.dictionaryData = DictionaryDataSchema.parse(JSON.parse(rawData));
		} catch (error) {
			throw new Error(`Failed to parse dictionary data for guild ${this.guildId}: ${error}`);
		}
	}

	public async save(): Promise<void> {
		await writeFile(
			new URL(`../../data/dictionary/${this.guildId}.json`, import.meta.url),
			JSON.stringify(this.dictionaryData),
			'utf8',
		);
	}

	public upsert(word: string, replaceWord: string, options?: { flags?: string; isRegExp?: boolean }): void {
		this.dictionaryData.data[word] = {
			replace: replaceWord,
			flags: options?.flags ?? 'gi',
			isRegExp: options?.isRegExp ?? false,
		};
	}

	public delete(word: string): boolean {
		if (!this.dictionaryData.data[word]) return false;
		const { [word]: _, ...rest } = this.dictionaryData.data;
		this.dictionaryData.data = rest;
		return true;
	}

	public get data(): DictionaryData {
		return this.dictionaryData;
	}
}
