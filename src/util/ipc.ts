import type { ChildProcess } from 'node:child_process';
import { setTimeout, clearTimeout } from 'node:timers';

export const JoinResultCode = {
	Success: 0,
	NotVoiceChannel: 1,
	AlreadyConnected: 2,
	PermissionError: 3,
	Unknown: 99,
} as const;
export type JoinResultCode = (typeof JoinResultCode)[keyof typeof JoinResultCode];

export const LeaveResultCode = {
	Success: 0,
	NotVoiceChannel: 1,
	NotConnected: 2,
	Unknown: 99,
} as const;
export type LeaveResultCode = (typeof LeaveResultCode)[keyof typeof LeaveResultCode];

export const SkipResultCode = {
	Success: 0,
	NotVoiceChannel: 1,
	NotConnected: 2,
	Unknown: 99,
} as const;
export type SkipResultCode = (typeof SkipResultCode)[keyof typeof SkipResultCode];

export type IPCJoinMessage = { channelId: string; reconnect?: boolean; type: 'join' };

export type IPCLeaveMessage = { channelId: string; type: 'leave' };

export type IPCJoinResultMessage = {
	channelId: string;
	code: JoinResultCode;
	reason?: string;
	success: boolean;
	type: 'joinResult';
};

export type IPCLeaveResultMessage = {
	channelId: string;
	code: LeaveResultCode;
	reason?: string;
	success: boolean;
	type: 'leaveResult';
};

export type IPCSkipMessage = { channelId: string; type: 'skip' };

export type IPCSkipResultMessage = {
	channelId: string;
	code: SkipResultCode;
	reason?: string;
	success: boolean;
	type: 'skipResult';
};

export type IPCVoiceConnectionStatusMessage = {
	type: 'voiceConnectionStatus';
};

export type IPCVoiceConnectionStatusResultMessage = {
	displayName: string;
	memoryUsage: number;
	ping: number;
	type: 'voiceConnectionStatusResult';
	voiceConnections: {
		audioPlayerStatus: string;
		channelId: string;
		connectionStatus: string;
		ping: number | undefined;
	}[];
};

export type IPCDictionaryReloadMessage = {
	type: 'dictionaryReload';
};

export type IPCConfigReloadMessage = {
	type: 'configReload';
};

export type IPCChildReadyMessage = {
	type: 'childReady';
};

export type IPCDisconnectMessage = {
	channelId: string;
	type: 'disconnect';
};

export type IPCMessage =
	| IPCChildReadyMessage
	| IPCConfigReloadMessage
	| IPCDictionaryReloadMessage
	| IPCDisconnectMessage
	| IPCJoinMessage
	| IPCJoinResultMessage
	| IPCLeaveMessage
	| IPCLeaveResultMessage
	| IPCSkipMessage
	| IPCSkipResultMessage
	| IPCVoiceConnectionStatusMessage
	| IPCVoiceConnectionStatusResultMessage;

export type IPCResultMap = {
	joinResult: IPCJoinResultMessage;
	leaveResult: IPCLeaveResultMessage;
	skipResult: IPCSkipResultMessage;
	voiceConnectionStatusResult: IPCVoiceConnectionStatusResultMessage;
};

type IPCResultKey = keyof IPCResultMap;

type WithChannelId = {
	[K in IPCResultKey]: IPCResultMap[K] extends { channelId: string } ? K : never;
}[IPCResultKey];

type WithoutChannelId = Exclude<IPCResultKey, WithChannelId>;

export function waitIPCResult<K extends WithChannelId>(
	client: ChildProcess,
	type: K,
	channelId: string,
	timeoutMs?: number,
): Promise<IPCResultMap[K]>;

export function waitIPCResult<K extends WithoutChannelId>(
	client: ChildProcess,
	type: K,
	channelId?: undefined,
	timeoutMs?: number,
): Promise<IPCResultMap[K]>;

// eslint-disable-next-line @typescript-eslint/promise-function-async
export function waitIPCResult<K extends keyof IPCResultMap>(
	client: ChildProcess,
	type: K,
	channelId?: string,
	timeoutMs = 5_000,
): Promise<IPCResultMap[K]> {
	return new Promise((resolve, reject) => {
		// eslint-disable-next-line unicorn/consistent-function-scoping
		let cleanup = () => {};
		let timer: NodeJS.Timeout | undefined;
		let handler: ((message: IPCResultMap[K]) => void) | undefined;

		const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
			cleanup();
			reject(new Error(`Child process exited (code=${code}, signal=${signal})`));
		};

		const onDisconnect = () => {
			cleanup();
			reject(new Error('Child process disconnected'));
		};

		const onError = (err: Error) => {
			cleanup();
			reject(err);
		};

		cleanup = () => {
			if (timer) {
				clearTimeout(timer);
				timer = undefined;
			}

			if (handler) {
				client.off('message', handler);
				handler = undefined;
			}

			client.off('exit', onExit);
			client.off('disconnect', onDisconnect);
			client.off('error', onError);
		};

		handler = (message: IPCResultMap[K]) => {
			if (message.type === type) {
				if ('channelId' in message && channelId !== undefined && message.channelId !== channelId) return;

				cleanup();
				resolve(message);
			}
		};

		timer = setTimeout(() => {
			cleanup();
			reject(new Error(`${type} timeout`));
		}, timeoutMs);

		client.on('message', handler);
		client.once('exit', onExit);
		client.once('disconnect', onDisconnect);
		client.once('error', onError);
	});
}
