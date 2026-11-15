// Checks how ext.pickipediaReleases.videoPlayer.js chooses between hls.js,
// native HLS, and direct-file playback — specifically that an iPhone exposing
// ManagedMediaSource without MediaSource (iOS 17.1+) uses Safari's native HLS
// rather than hls.js (which plays audio over a black picture on AV1+Opus).
//
// Usage:
//   node extensions/PickiPediaReleases/tests/check-video-player.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(
	new URL('../resources/ext.pickipediaReleases.videoPlayer.js', import.meta.url),
	'utf8'
);

function makeElement(tag, env) {
	const attrs = new Map();
	const listeners = new Map();
	const children = [];
	const classes = new Set();
	let innerHTML = '';
	const el = {
		tagName: tag.toUpperCase(),
		style: { cssText: '' },
		textContent: '',
		className: '',
		controls: false,
		playsInline: false,
		poster: '',
		src: '',
		playbackRate: 1,
		defaultPlaybackRate: 1,
		paused: true,
		currentTime: 0,
		duration: NaN,
		children,
		classList: {
			add: (c) => classes.add(c),
			remove: (c) => classes.delete(c),
			contains: (c) => classes.has(c),
		},
		get innerHTML() {
			return innerHTML;
		},
		set innerHTML(v) {
			innerHTML = String(v);
			children.length = 0;
		},
		setAttribute(k, v) {
			attrs.set(k, String(v));
		},
		getAttribute(k) {
			return attrs.has(k) ? attrs.get(k) : null;
		},
		hasAttribute(k) {
			return attrs.has(k);
		},
		appendChild(child) {
			children.push(child);
			if (tag === 'head' && child.tagName === 'SCRIPT') {
				env.scriptsLoaded.push(child.src);
				if (typeof child.onload === 'function') {
					Promise.resolve().then(() => child.onload());
				}
			}
			return child;
		},
		insertBefore(child) {
			children.unshift(child);
			return child;
		},
		querySelector(sel) {
			return children.find((c) => c.tagName === sel.toUpperCase()) || null;
		},
		addEventListener(type, fn) {
			if (!listeners.has(type)) listeners.set(type, []);
			listeners.get(type).push(fn);
		},
		removeEventListener() {},
		canPlayType(type) {
			return env.canPlayType(type);
		},
	};
	return el;
}

async function runScenario({
	cid = 'QmPQbCpdWbjNuXXb11vCx8NKiNR4vwYvJVG3Rgfpkatpb1',
	mediaSource = false,
	managedMediaSource = false,
	hlsPreloaded = false,
	hlsSupported = true,
	nativeHls = '',
}) {
	const hlsInstances = [];
	class FakeHls {
		static Events = { ERROR: 'error', MANIFEST_PARSED: 'manifest_parsed' };
		static ErrorTypes = { MEDIA_ERROR: 'mediaError' };
		static isSupported() {
			return hlsSupported;
		}
		constructor(options) {
			this.options = options;
			this.levels = [
				{ width: 720, height: 1280 },
				{ width: 360, height: 640 },
				{ width: 0, height: 0, uri: 'stream_audio/playlist.m3u8' },
			];
			this.handlers = {};
			this.loadedSource = null;
			this.attachedMedia = null;
			hlsInstances.push(this);
		}
		on(ev, fn) {
			this.handlers[ev] = fn;
		}
		loadSource(url) {
			this.loadedSource = url;
		}
		attachMedia(video) {
			this.attachedMedia = video;
		}
		destroy() {}
	}

	const env = {
		scriptsLoaded: [],
		canPlayType(type) {
			if (type === 'application/vnd.apple.mpegurl') return nativeHls;
			return 'probably';
		},
	};

	const container = makeElement('div', env);
	container.setAttribute('data-cid', cid);
	const head = makeElement('head', env);

	const windowObj = {
		location: { hash: '' },
		localStorage: {
			getItem: () => null,
			setItem: () => {},
		},
	};
	if (mediaSource) {
		windowObj.MediaSource = { isTypeSupported: () => true };
	}
	if (managedMediaSource) {
		windowObj.ManagedMediaSource = { isTypeSupported: () => true };
	}

	const context = {
		window: windowObj,
		document: {
			readyState: 'complete',
			head,
			createElement: (tag) => makeElement(tag, env),
			querySelectorAll: (sel) => {
				if (sel.includes(':not([data-initialized])') && !container.hasAttribute('data-initialized')) {
					return [container];
				}
				return [];
			},
			addEventListener: () => {},
		},
		fetch: () => Promise.resolve({ ok: false, text: () => Promise.resolve('') }),
		URL: { createObjectURL: () => 'blob:fake' },
		Blob: class {},
		Promise,
		Number,
		String,
		Math,
		encodeURIComponent,
		isNaN,
		isFinite,
		setTimeout,
		clearTimeout,
	};
	if (hlsPreloaded) {
		context.Hls = FakeHls;
		windowObj.Hls = FakeHls;
	} else {
		// Simulate the CDN script defining Hls once appended to <head>.
		const origAppend = head.appendChild.bind(head);
		head.appendChild = (child) => {
			if (child.tagName === 'SCRIPT') {
				context.Hls = FakeHls;
				windowObj.Hls = FakeHls;
			}
			return origAppend(child);
		};
	}

	vm.runInNewContext(src, context);
	await new Promise((r) => setTimeout(r, 10));

	const video = container.children.find((c) => c.tagName === 'VIDEO') || null;
	return { container, video, hlsInstances, scriptsLoaded: env.scriptsLoaded };
}

let failures = 0;
function check(name, ok, detail = '') {
	if (ok) {
		console.log(`  ok   ${name}`);
	} else {
		failures++;
		console.error(`  FAIL ${name}${detail ? '\n       ' + detail : ''}`);
	}
}

console.log('PickiPedia video player path selection:');

// 1. iPhone (iOS 17.1+): ManagedMediaSource present, MediaSource absent, native HLS supported.
{
	const res = await runScenario({
		mediaSource: false,
		managedMediaSource: true,
		hlsSupported: true,
		nativeHls: 'maybe',
	});
	check(
		'iPhone (ManagedMediaSource only) does not download hls.js',
		res.scriptsLoaded.length === 0,
		`loaded: ${JSON.stringify(res.scriptsLoaded)}`
	);
	check(
		'iPhone (ManagedMediaSource only) does not instantiate Hls',
		res.hlsInstances.length === 0,
		`instances: ${res.hlsInstances.length}`
	);
	check(
		'iPhone (ManagedMediaSource only) hands master.m3u8 to native <video>',
		res.video && res.video.src === 'https://ipfs.delivery-kid.cryptograss.live/ipfs/QmPQbCpdWbjNuXXb11vCx8NKiNR4vwYvJVG3Rgfpkatpb1/master.m3u8',
		`video.src: ${res.video && res.video.src}`
	);
}

// 2. iPhone even when window.Hls is already present on the page: still native HLS.
{
	const res = await runScenario({
		cid: 'Bafybeiavz2kvaf4rfv7q46hxse4fk2tcqpzm4mgr67jbdqa2wpdarcie5y',
		mediaSource: false,
		managedMediaSource: true,
		hlsPreloaded: true,
		hlsSupported: true,
		nativeHls: 'maybe',
	});
	check(
		'iPhone with preloaded Hls still uses native HLS and lowercases Bafy CID',
		res.hlsInstances.length === 0 &&
			res.video &&
			res.video.src === 'https://ipfs.delivery-kid.cryptograss.live/ipfs/bafybeiavz2kvaf4rfv7q46hxse4fk2tcqpzm4mgr67jbdqa2wpdarcie5y/master.m3u8',
		`instances=${res.hlsInstances.length} src=${res.video && res.video.src}`
	);
}

// 3. Desktop / Android / iPad with classic MediaSource: uses hls.js as before.
{
	const res = await runScenario({
		mediaSource: true,
		managedMediaSource: true,
		hlsSupported: true,
		nativeHls: 'maybe',
	});
	check(
		'Desktop/iPad with classic MediaSource loads hls.js',
		res.scriptsLoaded.length === 1,
		`loaded: ${JSON.stringify(res.scriptsLoaded)}`
	);
	check(
		'Desktop/iPad with classic MediaSource attaches Hls to master.m3u8',
		res.hlsInstances.length === 1 &&
			res.hlsInstances[0].loadedSource === 'https://ipfs.delivery-kid.cryptograss.live/ipfs/QmPQbCpdWbjNuXXb11vCx8NKiNR4vwYvJVG3Rgfpkatpb1/master.m3u8',
		`instances=${res.hlsInstances.length}`
	);
}

// 4. Browser with neither classic MediaSource nor native HLS: falls back to direct file.
{
	const res = await runScenario({
		mediaSource: false,
		managedMediaSource: false,
		hlsSupported: false,
		nativeHls: '',
	});
	check(
		'Browser without MediaSource or native HLS falls back to direct CID',
		res.hlsInstances.length === 0 &&
			res.video &&
			res.video.src === 'https://ipfs.delivery-kid.cryptograss.live/ipfs/QmPQbCpdWbjNuXXb11vCx8NKiNR4vwYvJVG3Rgfpkatpb1',
		`src=${res.video && res.video.src}`
	);
}

if (failures > 0) {
	process.exit(1);
}
console.log('All video player checks passed.');
