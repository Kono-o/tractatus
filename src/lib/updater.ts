import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { registerPlugin } from '@capacitor/core';
import { APP_VERSION } from './version';
import { isNativeApp } from './native';

export interface GitHubReleaseAsset {
	name: string;
	browser_download_url: string;
	url: string;
	size: number;
	content_type: string;
}

export interface GitHubRelease {
	tag_name: string;
	name: string | null;
	body: string | null;
	assets: GitHubReleaseAsset[];
	prerelease: boolean;
	draft: boolean;
	published_at: string;
}

export interface UpdateInfo {
	version: string;
	notes: string;
	downloadUrl: string;
	apiAssetUrl?: string;
	size: number;
	tag: string;
}

export interface UpdaterPlugin {
	installApk(options: { path: string }): Promise<void>;
	openInstallSettings(): Promise<void>;
	downloadUpdate(options: { url: string; expectedSize?: number }): Promise<{ path: string }>;
	canInstallFromUnknownSources(): Promise<{ canInstall: boolean }>;
	addListener(eventName: string, listenerFunc: (data?: any) => void): Promise<any>;
	removeListener(eventName: string, listenerFunc: (data?: any) => void): Promise<any>;
	removeAllListeners(eventName?: string): Promise<any>;
}

let _updaterNative: UpdaterPlugin | null = null;

export const UpdaterNative: UpdaterPlugin = ((): UpdaterPlugin => {
	if (_updaterNative) return _updaterNative;

	if (typeof window !== 'undefined' && (window as any).__UPDATER_REGISTERED__) {
		_updaterNative = {
			async installApk() { throw new Error('Updater plugin not available (web stub)'); },
			async openInstallSettings() {},
			async downloadUpdate() { throw new Error('Updater plugin not available (web stub)'); },
			async canInstallFromUnknownSources() { return { canInstall: true }; },
			async addListener() { return { remove: async () => {} }; },
			async removeListener() {},
			async removeAllListeners() {},
		};
		return _updaterNative;
	}

	try {
		_updaterNative = registerPlugin<UpdaterPlugin>('Updater');
		if (typeof window !== 'undefined') {
			(window as any).__UPDATER_REGISTERED__ = true;
		}
	} catch (e) {
		_updaterNative = {
			async installApk() { throw new Error('Updater plugin is only available on Android'); },
			async openInstallSettings() {},
			async downloadUpdate() { throw new Error('Updater plugin is only available on Android'); },
			async canInstallFromUnknownSources() { return { canInstall: true }; },
			async addListener() { return { remove: async () => {} }; },
			async removeListener() {},
			async removeAllListeners() {},
		};
	}
	return _updaterNative;
})();

/** GitHub repo for release checks. */
const GITHUB_OWNER = 'Kono-o';
const GITHUB_REPO = 'tractatus';
const RELEASE_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

let hasCheckedThisLaunch = false;
let dismissedVersionThisLaunch: string | null = null;

const LAST_SEEN_VERSION_KEY = 'tractatus:last-seen-version';

function getStoredLastSeenVersion(): string {
	if (typeof localStorage === 'undefined') return '0.0.0';
	return localStorage.getItem(LAST_SEEN_VERSION_KEY) || '0.0.0';
}

export function setLastSeenVersion(v: string): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(LAST_SEEN_VERSION_KEY, v);
}

export function isNewerVersion(a: string, b: string): boolean {
	const pa = a.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
	const pb = b.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
	const len = Math.max(pa.length, pb.length);
	for (let i = 0; i < len; i++) {
		const na = pa[i] ?? 0;
		const nb = pb[i] ?? 0;
		if (na > nb) return true;
		if (na < nb) return false;
	}
	return false;
}

export async function fetchLatestRelease(): Promise<GitHubRelease | null> {
	try {
		const res = await fetch(RELEASE_API, {
			headers: {
				Accept: 'application/vnd.github+json',
				'User-Agent': `Tractatus/${APP_VERSION} (Capacitor; https://github.com/Kono-o/tractatus)`,
				'X-GitHub-Api-Version': '2022-11-28',
			},
			cache: 'no-store',
		});
		if (!res.ok) {
			console.warn('[updater] GitHub release fetch failed with HTTP status:', res.status, 'for', RELEASE_API);
			try {
				const errBody = await res.text();
				console.warn('  response body:', errBody.slice(0, 200));
			} catch {}
			return null;
		}
		const data = (await res.json()) as GitHubRelease;
		if (data.draft || data.prerelease) return null;
		return data;
	} catch (e) {
		console.error('[updater] Failed to fetch release from GitHub:', e);
		return null;
	}
}

function pickApkAsset(release: GitHubRelease): GitHubReleaseAsset | null {
	const preferred = release.assets.find((a) => /tractatus-v.*\.apk$/i.test(a.name));
	if (preferred) return preferred;
	return release.assets.find((a) => a.name.toLowerCase().endsWith('.apk')) ?? null;
}

export function releaseToUpdateInfo(release: GitHubRelease): UpdateInfo | null {
	const asset = pickApkAsset(release);
	if (!asset) return null;
	const version = release.tag_name.replace(/^v/i, '');
	return {
		version,
		notes: release.body ?? '',
		downloadUrl: asset.browser_download_url,
		apiAssetUrl: asset.url,
		size: asset.size,
		tag: release.tag_name,
	};
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
	if (!isNativeApp() || Capacitor.getPlatform() !== 'android') {
		return null;
	}

	let release = await fetchLatestRelease();
	if (!release) {
		await new Promise((r) => setTimeout(r, 1200));
		release = await fetchLatestRelease();
	}

	if (!release) return null;
	const info = releaseToUpdateInfo(release);
	if (!info) return null;
	if (isNewerVersion(info.version, APP_VERSION)) {
		return info;
	}
	return null;
}

export async function downloadApkToCache(
	info: UpdateInfo,
	onProgress: (pct: number) => void
): Promise<string> {
	if (!isNativeApp()) {
		const releasesPage = info.downloadUrl.includes('/download/')
			? 'https://github.com/Kono-o/tractatus/releases'
			: info.downloadUrl;

		if (typeof window !== 'undefined') {
			window.open(releasesPage, '_blank');
		}
		throw new Error('Direct APK download only works inside the Android app. Opened the GitHub releases page instead.');
	}

	const fetchUrl = info.downloadUrl;
	let res: Response | null = null;
	let lastError: any = null;

	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			res = await fetch(fetchUrl, {
				cache: 'no-store',
				headers: {
					'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36',
					'Accept': 'application/octet-stream, */*',
				},
				redirect: 'follow',
			});

			if (!res.ok || !res.body) {
				lastError = new Error(`Download failed (${res.status})`);
				if (attempt < 3) {
					await new Promise(r => setTimeout(r, 1000 * attempt));
					continue;
				}
				throw lastError;
			}

			const contentType = res.headers.get('content-type') || '';
			if (contentType.includes('text/') || contentType.includes('html') || contentType.includes('json')) {
				const text = await res.text();
				lastError = new Error(`GitHub returned non-binary content (${contentType}): ${text.substring(0, 400)}`);
				if (attempt < 3) {
					await new Promise(r => setTimeout(r, 1000 * attempt));
					continue;
				}
				throw lastError;
			}

			const cl = res.headers.get('content-length');
			if (cl && parseInt(cl) < 10000) {
				const text = await res.text();
				lastError = new Error(`GitHub returned suspiciously small response (${cl} bytes): ${text.substring(0, 400)}`);
				if (attempt < 3) {
					await new Promise(r => setTimeout(r, 1000 * attempt));
					continue;
				}
				throw lastError;
			}

			break;
		} catch (e) {
			lastError = e;
			if (attempt < 3) {
				await new Promise(r => setTimeout(r, 1000 * attempt));
				continue;
			}
			throw lastError;
		}
	}

	if (!res) {
		throw lastError || new Error('Download failed after retries');
	}

	const contentLength = Number(res.headers.get('Content-Length') || info.size || 0);
	let received = 0;
	const chunks: Uint8Array[] = [];
	const reader = res.body!.getReader();

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value) {
			chunks.push(value);
			received += value.length;
			if (contentLength > 0) {
				onProgress(Math.min(99, Math.round((received / contentLength) * 100)));
			}
		}
	}
	onProgress(100);

	let totalLength = 0;
	for (const chunk of chunks) totalLength += chunk.length;
	const allBytes = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		allBytes.set(chunk, offset);
		offset += chunk.length;
	}

	const base64 = btoa(
		allBytes.reduce((data, byte) => data + String.fromCharCode(byte), '')
	);

	const relativePath = 'updates/tractatus-update.apk';
	await Filesystem.writeFile({
		path: relativePath,
		data: base64,
		directory: Directory.Cache,
		recursive: true,
	});

	if (info.size > 0) {
		const stat = await Filesystem.stat({
			path: relativePath,
			directory: Directory.Cache,
		});
		if (stat.size !== info.size) {
			try {
				await Filesystem.deleteFile({ path: relativePath, directory: Directory.Cache });
			} catch {}
			throw new Error(`Download corrupted (size mismatch: got ${stat.size} bytes, expected ${info.size}). The APK file is invalid and cannot be installed. Please try again with a stable connection.`);
		}
	}

	try {
		const header = await Filesystem.readFile({
			path: relativePath,
			directory: Directory.Cache,
		});
		const firstBytes = atob(header.data as string).slice(0, 4);
		if (!firstBytes.startsWith('PK')) {
			try {
				await Filesystem.deleteFile({ path: relativePath, directory: Directory.Cache });
			} catch {}
			throw new Error('Downloaded file is not a valid APK (wrong format). This usually means a network error or GitHub serving an error page. Please try again.');
		}
	} catch (e) {
		console.warn('[updater] Could not validate APK magic bytes, proceeding anyway:', e);
	}

	return relativePath;
}

export async function promptInstallApk(relativeCachePath: string): Promise<void> {
	await UpdaterNative.installApk({ path: relativeCachePath });
}

export async function openInstallPermissionSettings(): Promise<void> {
	await UpdaterNative.openInstallSettings();
}

export async function shouldShowUpdatePrompt(): Promise<UpdateInfo | null> {
	if (hasCheckedThisLaunch) {
		return null;
	}
	hasCheckedThisLaunch = true;

	const info = await checkForUpdate();
	if (!info) return null;

	if (dismissedVersionThisLaunch && dismissedVersionThisLaunch === info.version) {
		return null;
	}
	return info;
}

export function dismissUpdateThisLaunch(version: string): void {
	dismissedVersionThisLaunch = version;
}

export async function checkForPostUpdateChangelog(): Promise<{ version: string; notes: string } | null> {
	if (!isNativeApp() || Capacitor.getPlatform() !== 'android') return null;

	const lastSeen = getStoredLastSeenVersion();
	const isFirstRun = lastSeen === '0.0.0' || !lastSeen;

	if (isFirstRun) {
		setLastSeenVersion(APP_VERSION);
		return null;
	}

	if (!isNewerVersion(APP_VERSION, lastSeen)) {
		if (APP_VERSION !== lastSeen) setLastSeenVersion(APP_VERSION);
		return null;
	}

	const release = await fetchLatestRelease();
	const info = release ? releaseToUpdateInfo(release) : null;

	setLastSeenVersion(APP_VERSION);

	if (info && info.version === APP_VERSION.replace(/^v/i, '')) {
		return { version: info.version, notes: info.notes };
	}
	return { version: APP_VERSION.replace(/^v/i, ''), notes: '' };
}
