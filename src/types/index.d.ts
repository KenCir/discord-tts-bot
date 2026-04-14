import type { ChildProcess } from 'node:child_process';
import { Client } from 'discord.js';
import type { Config } from '../util/configData.js';
import type { SavedVoiceConnections } from '../util/savedVoiceConnections.js';
import type { VoiceConnectionManager } from '../voiceConnectionManager.js';

declare module 'discord.js' {
	// ここはinterfaceで定義する必要がある
	interface Client {
		childClients: Map<string, ChildProcess>;
		config: Config;
		savedVoiceConnections: SavedVoiceConnections;
		voiceConnectionManagers: Map<string, VoiceConnectionManager>;
	}
}
