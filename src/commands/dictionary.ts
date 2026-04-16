import type { ButtonInteraction } from 'discord.js';
import {
	ActionRowBuilder,
	ApplicationCommandOptionType,
	ButtonBuilder,
	ButtonStyle,
	ComponentType,
	EmbedBuilder,
	InteractionContextType,
	Locale,
} from 'discord.js';
import { Dictionary } from '../util/dictionaryData.js';
import type { Command } from './index.js';

export default {
	data: {
		name: 'dictionary',
		description: '辞書データの管理',
		contexts: [InteractionContextType.Guild],
		options: [
			{
				name: 'add',
				description: '辞書に単語を追加します',
				type: ApplicationCommandOptionType.Subcommand,
				options: [
					{
						name: 'word',
						name_localizations: {
							[Locale.Japanese]: '単語',
						},
						description: '追加する単語',
						required: true,
						type: ApplicationCommandOptionType.String,
					},
					{
						name: 'replace',
						name_localizations: {
							[Locale.Japanese]: '読み',
						},
						description: '単語の読み',
						required: true,
						type: ApplicationCommandOptionType.String,
					},
					{
						name: 'is_reg_exp',
						name_localizations: {
							[Locale.Japanese]: '正規表現',
						},
						description: '正規表現を使うかどうか',
						required: false,
						type: ApplicationCommandOptionType.Boolean,
					},
				],
			},
			{
				name: 'remove',
				description: '辞書から単語を削除します',
				type: ApplicationCommandOptionType.Subcommand,
				options: [
					{
						name: 'word',
						name_localizations: {
							[Locale.Japanese]: '単語',
						},
						description: '削除する単語',
						required: true,
						type: ApplicationCommandOptionType.String,
					},
				],
			},
			{
				name: 'list',
				description: '辞書に登録されている単語の一覧を表示します',
				type: ApplicationCommandOptionType.Subcommand,
			},
		],
	},
	async execute(interaction) {
		if (!interaction.inCachedGuild()) {
			await interaction.reply('このコマンドはDMで使用できません');
			return;
		}

		if (!interaction.isChatInputCommand()) {
			await interaction.reply('対応していない操作');
			return;
		}

		await interaction.deferReply();
		const subCommand = interaction.options.getSubcommand();

		if (subCommand === 'add') {
			const word = interaction.options.getString('word', true);
			const replace = interaction.options.getString('replace', true);
			const isRegExp = interaction.options.getBoolean('is_reg_exp') ?? false;

			const dictionary = new Dictionary(interaction.guildId);
			await dictionary.load();
			dictionary.upsert(word, replace, { isRegExp });
			await dictionary.save();
			const voiceConnectionManager = interaction.client.voiceConnectionManagers.get(interaction.guildId);
			if (voiceConnectionManager) {
				await voiceConnectionManager.reloadDictionary();
			}

			for (const childClient of interaction.client.childClients.values()) {
				childClient.send({
					type: 'dictionaryReload',
				});
			}

			await interaction.followUp({
				embeds: [
					new EmbedBuilder()
						.setTitle('辞書に単語を追加しました')
						.addFields(
							{ name: '単語', value: word },
							{ name: '読み', value: replace },
							{ name: '正規表現', value: isRegExp ? '有効' : '無効' },
						)
						.setColor('Green'),
				],
			});
		} else if (subCommand === 'remove') {
			const word = interaction.options.getString('word', true);

			const dictionary = new Dictionary(interaction.guildId);
			await dictionary.load();
			const success = dictionary.delete(word);
			await dictionary.save();
			if (success) {
				const voiceConnectionManager = interaction.client.voiceConnectionManagers.get(interaction.guildId);
				if (voiceConnectionManager) {
					await voiceConnectionManager.reloadDictionary();
				}

				for (const childClient of interaction.client.childClients.values()) {
					childClient.send({
						type: 'dictionaryReload',
					});
				}

				await interaction.followUp(`辞書データから単語\`${word}\`を削除しました`);
			} else {
				await interaction.followUp(`単語\`${word}\`は辞書に登録されていません`);
			}
		} else if (subCommand === 'list') {
			const dictionary = new Dictionary(interaction.guildId);
			await dictionary.load();
			if (Object.keys(dictionary.data.data).length === 0) {
				await interaction.followUp('辞書に登録されている単語はありません');
				return;
			}

			const embeds: EmbedBuilder[] = [];
			let page = 1;
			for (let index = 0; index < Object.keys(dictionary.data.data).length; index += 10) {
				const embed = new EmbedBuilder().setTitle(`単語帳 ${page++}ページ目`);
				const entries = Object.entries(dictionary.data.data).slice(index, index + 10);
				for (const [word, info] of entries) {
					embed.addFields({
						name: word,
						value: `\`${info.replace}\`\n正規表現: ${info.isRegExp ? '有効' : '無効'}`,
					});
				}

				embeds.push(embed);
			}

			if (embeds.length === 1) {
				await interaction.followUp({ embeds });
				return;
			}

			const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents([
				new ButtonBuilder().setCustomId('left').setLabel('◀️').setStyle(ButtonStyle.Primary).setDisabled(),
				new ButtonBuilder().setCustomId('right').setLabel('▶️').setStyle(ButtonStyle.Primary),
				new ButtonBuilder().setCustomId('stop').setLabel('⏹️').setStyle(ButtonStyle.Danger),
			]);
			const message = await interaction.followUp({
				embeds: [embeds[0]],
				components: [buttons],
				withResponse: true,
			});

			let select = 0;
			const filter = (componentInteraction: ButtonInteraction) => componentInteraction.user.id === interaction.user.id;
			const collector = message.createMessageComponentCollector({
				filter,
				componentType: ComponentType.Button,
				// time: 120_000, そのうち実装
			});
			collector.on('collect', async (componentInteraction) => {
				if (componentInteraction.customId === 'left') {
					select--;
					buttons.components[1].setDisabled(false);
					if (select < 1) {
						buttons.components[0].setDisabled();
					}

					await componentInteraction.update({
						embeds: [embeds[select]],
						components: [buttons],
					});
				} else if (componentInteraction.customId === 'right') {
					select++;
					buttons.components[0].setDisabled(false);
					if (select >= embeds.length - 1) {
						buttons.components[1].setDisabled();
					}

					await componentInteraction.update({
						embeds: [embeds[select]],
						components: [buttons],
					});
				} else if (componentInteraction.customId === 'stop') {
					buttons.components[0].setDisabled();
					buttons.components[1].setDisabled();
					buttons.components[2].setDisabled();
					await componentInteraction.update({
						embeds: [embeds[select]],
						components: [buttons],
					});
					collector.stop();
				}
			});
		}
	},
} satisfies Command;
