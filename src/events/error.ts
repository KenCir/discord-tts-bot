import { Events } from 'discord.js';
import { logger } from '../util/logger.js';
import type { Event } from './index.js';

export default {
	name: Events.Error,
	execute(error) {
		logger.error(error);
	},
} satisfies Event<Events.Error>;
