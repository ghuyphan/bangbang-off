import {
  destroyLocalRufflePlayer,
  loadLocalRuffleRuntime,
  rememberLocalRuffleContexts,
} from './m82_swf_player.js';
import {element} from './m8_ui_helpers.js';

const RUFFLE_ROOT = new URL('./vendor_m82/ruffle-0.7.1/', import.meta.url);
const prefetchedBytes = new Map();
let activeGate = null;

function battleStartMovie(assets) {
  const asset = assets?.get?.('movie.battleStart')
    || assets?.flashPolish?.assets?.['movie.battleStart']
    || assets?.get?.('zh_CN/swf/ui/battle_start.swf');
  const movie = asset?.nativeMovie;
  if (!movie?.url || movie.scriptTagTypes?.length) return null;
  const url = new URL(movie.url, document.baseURI);
  if (url.origin !== location.origin) return null;
  return {asset, movie, url};
}

async function verifiedMovieBytes(movie, url, signal) {
  if (prefetchedBytes.has(movie.sha256)) return prefetchedBytes.get(movie.sha256);
  const promise = (async () => {
    const response = await fetch(url, {signal, cache: 'force-cache', credentials: 'same-origin'});
    if (!response.ok) throw new Error(`Battle gate load failed (${response.status}).`);
    const data = await response.arrayBuffer();
    if (data.byteLength !== movie.bytes) throw new Error('Battle gate byte length mismatch.');
    if (!globalThis.crypto?.subtle) throw new Error('WebCrypto unavailable for gate SWF.');
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)),
      b => b.toString(16).padStart(2, '0')).join('');
    if (hash !== movie.sha256) throw new Error('Battle gate SHA-256 mismatch.');
    return data;
  })();
  prefetchedBytes.set(movie.sha256, promise);
  try {
    return await promise;
  } catch (error) {
    prefetchedBytes.delete(movie.sha256);
    throw error;
  }
}

export function prewarmBattleGate(assets) {
  const info = battleStartMovie(assets);
  if (!info) return;
  loadLocalRuffleRuntime().catch(() => {});
  verifiedMovieBytes(info.movie, info.url).catch(() => {});
}

/**
 * Plays zh_CN/swf/ui/battle_start.swf as a non-blocking visual gate opening
 * curtain over the live battle canvas when transitioning from loading -> scene.
 */
export function playBattleGateOpening(assets) {
  activeGate?.dispose?.();
  activeGate = null;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    return {dispose() {}};
  }
  const info = battleStartMovie(assets);
  if (!info || !document.body) return {dispose() {}};

  const overlay = element('div', null, 'm86-gate-transition');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.dataset.testid = 'm86-gate-transition';
  document.body.append(overlay);

  const controller = new AbortController();
  const durationMs = Math.max(1500, Math.round(((info.movie.frames || 97) / (info.movie.fps || 24)) * 1000));
  let disposed = false;
  let player = null;
  let fadeTimer = null;
  let cleanupTimer = null;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    controller.abort();
    clearTimeout(fadeTimer);
    clearTimeout(cleanupTimer);
    if (player) {
      destroyLocalRufflePlayer(player);
      player = null;
    }
    overlay.remove();
    if (activeGate?.dispose === dispose) activeGate = null;
  };

  fadeTimer = setTimeout(() => {
    if (!disposed) overlay.classList.add('is-fading');
  }, Math.max(600, durationMs - 320));
  cleanupTimer = setTimeout(dispose, durationMs + 150);

  (async () => {
    try {
      const [runtime, data] = await Promise.all([
        loadLocalRuffleRuntime(),
        verifiedMovieBytes(info.movie, info.url, controller.signal),
      ]);
      if (disposed || !overlay.isConnected) return;
      player = runtime.createPlayer();
      player.tabIndex = -1;
      player.setAttribute('aria-hidden', 'true');
      Object.assign(player.style, {
        position: 'absolute',
        inset: '0',
        display: 'block',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        visibility: 'hidden',
        background: 'transparent',
      });
      overlay.append(player);
      const api = player.ruffle(1);
      const ready = () => {
        rememberLocalRuffleContexts(player);
        if (disposed || !overlay.isConnected) return;
        player.style.visibility = 'visible';
        api.volume = 0;
        api.resume();
      };
      player.addEventListener('loadeddata', ready, {once: true});
      await api.load({
        data,
        swfFileName: 'battle_start.swf',
        publicPath: RUFFLE_ROOT.href,
        autoplay: 'on',
        unmuteOverlay: 'hidden',
        splashScreen: false,
        contextMenu: 'off',
        showSwfDownload: false,
        allowFullscreen: false,
        allowScriptAccess: false,
        allowNetworking: 'none',
        openUrlMode: 'deny',
        polyfills: false,
        compatibilityRules: false,
        backgroundExecutionMode: 'suspend',
        wmode: 'transparent',
        letterbox: 'off',
        scale: 'exactFit',
        salign: 'TL',
        forceScale: true,
        forceAlign: true,
        logLevel: 'error',
      });
      rememberLocalRuffleContexts(player);
      if (disposed || !overlay.isConnected) {
        destroyLocalRufflePlayer(player);
        player = null;
        return;
      }
      if (api.readyState >= 2) ready();
    } catch {
      dispose();
    }
  })();

  const handle = {dispose};
  activeGate = handle;
  return handle;
}
