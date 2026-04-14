import { Events } from 'discord.js';
import { logger } from '../util/logger.js';
import type { Event } from './index.js';

export default {
	name: Events.Debug,
	async execute(info) {
		logger.debug(info);
	},
} satisfies Event<Events.Debug>;
