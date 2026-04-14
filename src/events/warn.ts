import { Events } from 'discord.js';
import { logger } from '../util/logger.js';
import type { Event } from './index.js';

export default {
	name: Events.Warn,
	execute(info) {
		logger.warn(info);
	},
} satisfies Event<Events.Warn>;
