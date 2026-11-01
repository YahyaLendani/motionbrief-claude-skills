/**
 * runtime-check — open the composition in a headless browser, seek through each
 * beat, and report what can actually be read on screen and when.
 *
 * This is what static checks cannot do: a line in the markup can still be
 * transparent, clipped, covered or off-screen, and a count-up's final number only
 * exists at runtime. Both engines are driven through the page they render from:
 *
 *   hyperframes  the engine's own bundle and player, served locally. The bundling
 *                helper is an internal of the pinned version.
 *   remotion     the project's `remotion bundle` output and the page hooks the
 *                renderer itself seeks with. Those hooks are internal to Remotion,
 *                which is one reason the version is pinned.
 *
 * Any failure to get that far returns { status: "unavailable", reason } so the
 * requirement stays unverified. It never counts as a pass. Project code runs only
 * inside the browser, exactly as it does when rendering.
 *
 * The browser is spoken to over CDP with Node's built-in WebSocket (Node 22+), so
 * the skill's offline scripts stay dependency-free.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { matchFragments } from "./copy-rules.mjs";
import {
  PINS,
  capture,
  findBrowser,
  hyperframesPackageDir,
  installedHyperframesVersion,
  installedRemotionVersion,
  remotionEntry,
} from "./toolchain.mjs";

/** A line that is on screen for less than this cannot be read. */
export const DEFAULT_HOLD = 0.4;
const SAMPLE_STEP = 1 / 15;
const PHONE_WIDTH = 390;
const MIN_PHONE_FONT_PX = 11;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

/* ------------------------------------------------------------------ */
/* What is readable: runs inside the page                              */
/* ------------------------------------------------------------------ */

function probePage() {
  const W = innerWidth;
  const H = innerHeight;
  const alpha = (color) => {
    const m = /rgba?\(([^)]+)\)/.exec(color);
    if (!m) return color === "transparent" ? 0 : 1;
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    return parts.length >= 4 ? parseFloat(parts[3]) : 1;
  };
  const paintsOpaque = (el) => {
    if (["IMG", "VIDEO", "CANVAS"].includes(el.tagName)) return true;
    return alpha(getComputedStyle(el).backgroundColor) >= 0.9;
  };
  const effectiveOpacity = (el) => {
    let o = 1;
    for (let e = el; e; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity);
    return o;
  };

  const ruler = document.createElement("canvas").getContext("2d");

  window.__mbElements = [];
  const fragments = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.nodeValue.trim()) continue;
    const el = node.parentElement;
    if (!el || el.closest("script,style,noscript,template")) continue;

    const reasons = new Set();
    const cs = getComputedStyle(el);
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);

    if (rects.length === 0) reasons.add("hidden");
    if (cs.visibility !== "visible") reasons.add("hidden");

    // Ink: gradient text is transparent by design and still readable.
    const fill = cs.webkitTextFillColor || cs.color;
    const clipsBackground = (cs.webkitBackgroundClip || cs.backgroundClip) === "text" && cs.backgroundImage !== "none";
    const inkless = (alpha(cs.color) < 0.1 || alpha(fill) < 0.1) && !clipsBackground;
    if (inkless) reasons.add("transparent");

    const opacity = effectiveOpacity(el);
    if (opacity < 0.6) reasons.add("transparent");

    let box = null;
    let area = 0;
    let shown = 0;
    if (rects.length > 0) {
      let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const r of rects) {
        left = Math.min(left, r.left);
        top = Math.min(top, r.top);
        right = Math.max(right, r.right);
        bottom = Math.max(bottom, r.bottom);
      }
      box = { x: left, y: top, w: right - left, h: bottom - top };

      // Clip the text by the viewport and by every clipping ancestor.
      let [cl, ct, cr, cb] = [0, 0, W, H];
      let blur = 0;
      for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
        const s = getComputedStyle(e);
        const clips = [s.overflowX, s.overflowY].some((v) => v !== "visible");
        if (clips && e !== document.body) {
          const b = e.getBoundingClientRect();
          cl = Math.max(cl, b.left);
          ct = Math.max(ct, b.top);
          cr = Math.min(cr, b.right);
          cb = Math.min(cb, b.bottom);
        }
        const inset = /^inset\(([^)]+)\)/.exec(s.clipPath);
        if (inset) {
          const v = inset[1].split(/\s+/).map((p) => (p.endsWith("%") ? parseFloat(p) : NaN));
          const [t, r2 = t, b2 = t, l = r2] = v;
          const b = e.getBoundingClientRect();
          if (Number.isFinite(t)) ct = Math.max(ct, b.top + (b.height * t) / 100);
          if (Number.isFinite(r2)) cr = Math.min(cr, b.right - (b.width * r2) / 100);
          if (Number.isFinite(b2)) cb = Math.min(cb, b.bottom - (b.height * b2) / 100);
          if (Number.isFinite(l)) cl = Math.max(cl, b.left + (b.width * l) / 100);
        }
        const m = /blur\(([\d.]+)px\)/.exec(s.filter);
        if (m) blur += parseFloat(m[1]);
      }
      // A text rect is the font's whole line box. A reveal mask routinely trims the empty
      // part of that, so what must survive the clip is the ink of these glyphs.
      ruler.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const ink = ruler.measureText(cs.textTransform === "uppercase" ? node.nodeValue.toUpperCase() : node.nodeValue);
      const lineBox = ink.fontBoundingBoxAscent + ink.fontBoundingBoxDescent;
      const above = lineBox > 0 ? Math.max(0, (ink.fontBoundingBoxAscent - ink.actualBoundingBoxAscent) / lineBox) : 0;
      const below = lineBox > 0 ? Math.max(0, (ink.fontBoundingBoxDescent - ink.actualBoundingBoxDescent) / lineBox) : 0;
      for (const r of rects) {
        const inkTop = r.top + r.height * above;
        const inkBottom = r.bottom - r.height * below;
        area += r.width * (inkBottom - inkTop);
        const w = Math.max(0, Math.min(r.right, cr) - Math.max(r.left, cl));
        const h = Math.max(0, Math.min(inkBottom, cb) - Math.max(inkTop, ct));
        shown += w * h;
      }
      if (shown === 0) {
        const outside = right <= 0 || bottom <= 0 || left >= W || top >= H;
        reasons.add(outside ? "off-screen" : "clipped");
      } else if (shown / area < 0.97) {
        reasons.add("clipped");
      }
      if (blur > 2) reasons.add("blurred");

      // Covered: an opaque element painted above the text at its centre.
      if (reasons.size === 0) {
        const cx = Math.min(W - 1, Math.max(0, left + (right - left) / 2));
        const cy = Math.min(H - 1, Math.max(0, top + (bottom - top) / 2));
        const stack = document.elementsFromPoint(cx, cy);
        const at = stack.findIndex((e) => e === el || el.contains(e));
        if (at > 0) {
          for (const e of stack.slice(0, at)) {
            if (!e.contains(el) && paintsOpaque(e) && effectiveOpacity(e) >= 0.9) {
              reasons.add("covered");
              break;
            }
          }
        }
      }
    }

    // The nearest block groups the words of one line for the overlap check.
    let block = el;
    while (block.parentElement && /^(inline|contents)/.test(getComputedStyle(block).display)) block = block.parentElement;
    let blockId = window.__mbElements.indexOf(block);
    if (blockId === -1) blockId = window.__mbElements.push(block) - 1;

    fragments.push({
      text: node.nodeValue,
      reasons: [...reasons],
      // On the frame at all, even mid-animation: blurred or faint text is not a blank frame.
      painted: shown > 0 && cs.visibility === "visible" && !inkless && opacity >= 0.1,
      box,
      fontPx: parseFloat(cs.fontSize),
      family: cs.fontFamily,
      block: blockId,
      element: window.__mbElements.push(el) - 1,
    });
  }
  const beats = [...document.querySelectorAll("[data-brief-beat]")].map((e) => e.getAttribute("data-brief-beat"));
  const graphic = [...document.querySelectorAll("svg,img,canvas,video")].some((e) => {
    const r = e.getBoundingClientRect();
    const onScreen = r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < W && r.top < H;
    return onScreen && getComputedStyle(e).visibility === "visible" && effectiveOpacity(e) >= 0.1;
  });
  return { fragments, beats, graphic };
}

/* ------------------------------------------------------------------ */
/* CDP                                                                 */
/* ------------------------------------------------------------------ */

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id === undefined) return;
      const waiter = this.pending.get(msg.id);
      if (!waiter) return;
      this.pending.delete(msg.id);
      if (msg.error) waiter.reject(new Error(`${waiter.method}: ${msg.error.message}`));
      else waiter.resolve(msg.result);
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej, method });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
}

/** Why the browser stopped. A full Chrome keeps a socket in TMPDIR, and its path has a length limit. */
export function browserExitMessage(code, stderr) {
  const hint = /Socket path too long/.test(stderr) ? `TMPDIR is too long for this Chrome's socket: set a shorter TMPDIR, or let the engine fetch its own browser. ` : "";
  return `${hint}the browser exited with code ${code}: ${stderr.slice(0, 300)}`;
}

/** Both engines run their own build with the sandbox off, and Remotion's can crash at launch with it on. */
export function sandboxOff(path) {
  return basename(path).startsWith("chrome-headless-shell") || process.env.MOTIONBRIEF_CHROME_NO_SANDBOX === "1" || process.getuid?.() === 0;
}

function launchBrowser(path) {
  const profile = mkdtempSync(join(tmpdir(), "motionbrief-browser-"));
  const flags = [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    "--mute-audio",
    "--disable-dev-shm-usage",
    "--force-device-scale-factor=1",
    ...(sandboxOff(path) ? ["--no-sandbox"] : []),
    "about:blank",
  ];
  const child = spawn(path, flags, { stdio: ["ignore", "ignore", "pipe"], shell: false });
  const cleanup = () => {
    child.kill();
    setTimeout(() => {
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {
        /* a locked profile in a temp directory is not worth failing over */
      }
    }, 200).unref();
  };
  const endpoint = new Promise((res, rej) => {
    let err = "";
    const timer = setTimeout(() => rej(new Error("the browser did not start in 30 s")), 30000);
    child.stderr.on("data", (d) => {
      err += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(err);
      if (m) {
        clearTimeout(timer);
        res(m[1]);
      }
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      rej(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      rej(new Error(browserExitMessage(code, err)));
    });
  });
  return { endpoint, cleanup };
}

async function openPage(wsUrl, width, height) {
  const socket = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    socket.addEventListener("open", res, { once: true });
    socket.addEventListener("error", () => rej(new Error("could not connect to the browser")), { once: true });
  });
  const cdp = new Cdp(socket);
  const { product } = await cdp.send("Browser.getVersion");
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);
  await send("Page.enable");
  await send("Runtime.enable");
  await send("DOM.enable");
  await send("CSS.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });

  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    }
    return r.result.value;
  };

  const waitFor = async (expression, label, timeoutMs = 60000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (await evaluate(expression)) return;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
      await new Promise((r) => setTimeout(r, 40));
    }
  };

  /** The fonts that really drew an element, or null if the browser would not say. */
  const fontsOf = async (elementIndex) => {
    try {
      await send("DOM.getDocument", { depth: 0 });
      const { result } = await send("Runtime.evaluate", { expression: `window.__mbElements[${elementIndex}]` });
      const { nodeId } = await send("DOM.requestNode", { objectId: result.objectId });
      const { fonts } = await send("CSS.getPlatformFontsForNode", { nodeId });
      return fonts.map((f) => ({ family: f.familyName, custom: f.isCustomFont, glyphs: f.glyphCount }));
    } catch {
      return null;
    }
  };

  return { send, evaluate, waitFor, fontsOf, product, close: () => socket.close() };
}

/* ------------------------------------------------------------------ */
/* Serving                                                             */
/* ------------------------------------------------------------------ */

function serve(root, indexHtml = null) {
  const base = resolve(root);
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (indexHtml !== null && (path === "/" || path === "/index.html")) {
      res.writeHead(200, { "content-type": MIME[".html"] });
      return res.end(indexHtml);
    }
    const file = resolve(base, `.${path === "/" ? "/index.html" : path}`);
    if ((file !== base && !file.startsWith(base + sep)) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream", "access-control-allow-origin": "*" });
    res.end(readFileSync(file));
  });
  return new Promise((res, rej) => {
    server.on("error", rej);
    server.listen(0, "127.0.0.1", () => res({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }));
  });
}

/* ------------------------------------------------------------------ */
/* Engines                                                             */
/* ------------------------------------------------------------------ */

async function openHyperFrames(dir, browserWs, brief) {
  const version = installedHyperframesVersion();
  if (!version) throw new Error(`hyperframes@${PINS.hyperframes} is not installed — motion-render.mjs installs it, or run doctor.mjs`);

  const dist = join(hyperframesPackageDir(), "dist");
  const helper = readdirSync(dist).find((f) => /^bundleWithLocalizedFonts-.*\.js$/.test(f));
  if (!helper) throw new Error(`hyperframes@${version} has no bundling helper this check knows about`);
  const { bundleWithLocalizedFonts } = await import(pathToFileURL(join(dist, helper)).href);
  const html = await bundleWithLocalizedFonts(dir);

  const server = await serve(dir, html);
  const f = brief.format ?? {};
  const page = await openPage(browserWs, f.width ?? 1920, f.height ?? 1080);
  await page.send("Page.navigate", { url: `${server.url}/index.html` });
  await page.waitFor("Boolean(window.__renderReady) || typeof window.__hfStartupError === 'string'", "the composition to be ready");
  const startup = await page.evaluate("window.__hfStartupError ?? null");
  if (startup) throw new Error(`the composition failed to start: ${startup}`);
  await page.evaluate("document.fonts.ready.then(() => true)");

  const seek = async (t) => {
    await page.evaluate(`(async () => {
      const p = window.__player;
      (p.renderSeek ?? p.seek).call(p, ${t});
      if (window.__hfWaitForSeekCompletion) await window.__hfWaitForSeekCompletion();
      return true;
    })()`);
  };
  return { page, seek, close: () => server.close(), engine: { name: "hyperframes", version }, format: null };
}

async function openRemotion(dir, browserWs, brief, composition) {
  const entry = remotionEntry(dir);
  const version = installedRemotionVersion(dir);
  if (!entry || !version) throw new Error(`Remotion is not installed in ${dir} — run "npm ci" there`);

  const source = ["src/index.ts", "src/index.tsx", "src/index.js", "src/index.jsx"].find((p) => existsSync(join(dir, p)));
  if (!source) throw new Error(`no src/index.ts(x) entry point in ${dir}`);

  const out = mkdtempSync(join(tmpdir(), "motionbrief-bundle-"));
  const built = capture(process.execPath, [entry, "bundle", source, `--out-dir=${out}`, "--log=error"], { cwd: dir, timeout: 300000 });
  if (built.code !== 0) throw new Error(`remotion bundle failed: ${(built.stderr || built.stdout).slice(-400)}`);

  const server = await serve(out);
  const page = await openPage(browserWs, brief.format?.width ?? 1920, brief.format?.height ?? 1080);
  // The same globals the renderer sets before opening a bundle.
  await page.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      window.remotion_envVariables = "{}";
      window.remotion_inputProps = "{}";
      window.remotion_initialFrame = 0;
      window.remotion_attempt = 1;
      window.remotion_proxyPort = 0;
      window.remotion_audioEnabled = false;
      window.remotion_videoEnabled = true;
      window.remotion_logLevel = "error";
      window.remotion_isMainTab = true;
      window.remotion_puppeteerTimeout = 30000;
      window.remotion_broadcastChannel = new BroadcastChannel("motionbrief-runtime");
    `,
  });
  await page.send("Page.navigate", { url: `${server.url}/index.html` });
  await page.waitFor("typeof window.remotion_setBundleMode === 'function'", "the Remotion bundle");
  await page.evaluate("window.remotion_setBundleMode({ type: 'evaluation' })");
  await page.waitFor("window.remotion_renderReady === true", "Remotion to evaluate the root");

  const names = await page.evaluate("Promise.resolve(window.getStaticCompositions()).then((list) => list.map((c) => c.id))");
  const id = composition && names.includes(composition) ? composition : composition ? null : names[0];
  if (!id) throw new Error(`no composition "${composition}" at runtime (found: ${names.join(", ")})`);

  const meta = await page.evaluate(`window.remotion_calculateComposition(${JSON.stringify(id)})`);
  await page.evaluate(`window.remotion_setBundleMode(${JSON.stringify({
    type: "composition",
    compositionName: id,
    serializedResolvedPropsWithSchema: meta.serializedResolvedPropsWithCustomSchema,
    compositionDurationInFrames: meta.durationInFrames,
    compositionFps: meta.fps,
    compositionHeight: meta.height,
    compositionWidth: meta.width,
    compositionDefaultCodec: meta.defaultCodec,
    compositionDefaultOutName: meta.defaultOutName,
    compositionDefaultVideoImageFormat: meta.defaultVideoImageFormat,
    compositionDefaultPixelFormat: meta.defaultPixelFormat,
    compositionDefaultProResProfile: meta.defaultProResProfile,
    compositionDefaultSampleRate: meta.defaultSampleRate,
  })})`);
  await page.waitFor("window.remotion_renderReady === true", "the composition to mount");

  const fps = meta.fps;
  const seek = async (t) => {
    const frame = Math.round(t * fps);
    await page.evaluate(`window.remotion_setFrame(${frame}, ${JSON.stringify(id)}, 1)`);
    await page.waitFor("window.remotion_renderReady === true", `frame ${frame}`);
  };
  return {
    page,
    seek,
    close: () => {
      server.close();
      rmSync(out, { recursive: true, force: true });
    },
    engine: { name: "remotion", version },
    format: { width: meta.width, height: meta.height, fps: meta.fps, durationInFrames: meta.durationInFrames },
  };
}

/* ------------------------------------------------------------------ */
/* Inspection                                                          */
/* ------------------------------------------------------------------ */

const num = (v) => typeof v === "number" && Number.isFinite(v);
const round3 = (v) => Math.round(v * 1000) / 1000;

function overlaps(fragments) {
  const shown = fragments.filter((f) => f.box && f.reasons.length === 0);
  for (let i = 0; i < shown.length; i++) {
    for (let j = i + 1; j < shown.length; j++) {
      const [a, b] = [shown[i], shown[j]];
      if (a.block === b.block) continue;
      const w = Math.min(a.box.x + a.box.w, b.box.x + b.box.w) - Math.max(a.box.x, b.box.x);
      const h = Math.min(a.box.y + a.box.h, b.box.y + b.box.h) - Math.max(a.box.y, b.box.y);
      if (w <= 0 || h <= 0) continue;
      const smaller = Math.min(a.box.w * a.box.h, b.box.w * b.box.h);
      if ((w * h) / smaller > 0.2) return [a.text.trim(), b.text.trim()];
    }
  }
  return null;
}

/**
 * The frames a beat's data-brief-beat marker is mounted on, or null when the
 * scene carries no marker inside its window (nothing is then known).
 */
async function mountWindow({ page, seek, format }, probe, key, beat, fps) {
  const expected = { start: Math.round(beat.start * fps), duration: Math.round(beat.duration * fps) };
  const end = expected.start + expected.duration;
  const mountedAt = async (frame) => {
    // A seek past the last frame lands on the last frame, so nothing is mounted there.
    if (frame < 0 || frame >= format.durationInFrames) return false;
    await seek(frame / fps);
    return (await page.evaluate(probe)).beats.includes(key);
  };

  const anchor = expected.start + Math.floor(expected.duration / 2);
  if (!(await mountedAt(anchor))) return null;
  const edgesMatch = (await mountedAt(expected.start)) && (await mountedAt(end - 1)) && !(await mountedAt(expected.start - 1)) && !(await mountedAt(end));
  if (edgesMatch) return { expected, actualStart: expected.start, actualEnd: end, boundaryOk: true };

  // Off the expected edges: walk out from the middle to report where it really is.
  let actualStart = anchor;
  while (await mountedAt(actualStart - 1)) actualStart--;
  let actualEnd = anchor + 1;
  while (actualEnd < end + 1800 && (await mountedAt(actualEnd))) actualEnd++;
  return { expected, actualStart, actualEnd, boundaryOk: false };
}

async function inspectBeats(session, brief) {
  const { page, seek } = session;
  const f = brief.format ?? {};
  const fps = num(f.fps) ? f.fps : 30;
  const step = Math.max(1 / fps, SAMPLE_STEP);
  const probe = `(${probePage.toString()})()`;
  const brandFamily = brief.brand?.type?.family ?? null;

  const beats = {};
  const advisories = new Map();
  const fonts = [];
  const advise = (code, message) => {
    if (!advisories.has(`${code}:${message}`)) advisories.set(`${code}:${message}`, { code, message });
  };

  const beatList = Array.isArray(brief.beats) ? brief.beats : [];
  for (const [index, beat] of beatList.entries()) {
    const key = beat.id ? String(beat.id) : String(index);
    if (!num(beat.start) || !num(beat.duration)) continue;

    const lines = Array.isArray(beat.copy) ? beat.copy : [];
    const tally = lines.map(() => ({ present: false, hits: [], reasons: new Set() }));
    const end = beat.start + beat.duration;
    const times = [];
    for (let t = beat.start; t < end - 1e-6; t += step) times.push(round3(t));
    const last = round3(end - 1 / fps);
    if (times.at(-1) !== last && last > beat.start) times.push(last);

    let firstFrameVisible;
    let firstFrameGraphic = false;
    for (const t of times) {
      await seek(t);
      const { fragments, graphic } = await page.evaluate(probe);
      lines.forEach((line, n) => {
        if (typeof line !== "string" || line.trim() === "") return;
        const m = matchFragments(line, fragments);
        if (m.present) tally[n].present = true;
        if (m.visible) tally[n].hits.push(t);
        else for (const r of m.reasons) tally[n].reasons.add(r);
      });
      if (t === times[0] && beat.visibleAtStart) {
        const painted = fragments.map((frag) => ({ ...frag, reasons: frag.painted ? [] : ["not painted"] }));
        const required = lines.filter((line) => typeof line === "string" && line.trim() !== "");
        // With no copy to look for, nothing is known about this frame: left undefined.
        if (required.length > 0) firstFrameVisible = required.some((line) => matchFragments(line, painted).visible);
        firstFrameGraphic = graphic;
      }
      const clash = overlaps(fragments);
      if (clash) advise("text_overlap", `"${clash[0]}" overlaps "${clash[1]}" at ${t}s in beat "${key}"`);
    }

    const copy = tally.map((r) => {
      let longest = 0;
      let run = 0;
      let prev = null;
      let best = null;
      for (const t of r.hits) {
        run = prev !== null && t - prev <= step * 1.5 ? run + 1 : 1;
        prev = t;
        if (run > longest) {
          longest = run;
          best = t;
        }
      }
      return {
        present: r.present,
        visibleSeconds: round3(r.hits.length * step),
        longestRun: round3(longest * step),
        firstVisibleAt: r.hits[0] ?? null,
        settledAt: best,
        reasons: [...r.reasons],
      };
    });

    // At the settled frame: which font really drew each line, and its phone size.
    for (const [n, line] of lines.entries()) {
      const at = copy[n]?.settledAt;
      if (at === null || at === undefined) continue;
      await seek(at);
      const { fragments } = await page.evaluate(probe);
      const hit = matchFragments(line, fragments).fragments[0];
      if (!hit) continue;
      const used = await page.fontsOf(hit.element);
      fonts.push({ beat: key, line, used });
      if (used === null) {
        advise("font_check_unavailable", `the browser did not report which fonts drew the copy in beat "${key}" — check the frames`);
      } else if (brandFamily && used.length > 0 && !used.some((u) => u.family.toLowerCase().includes(brandFamily.toLowerCase()))) {
        advise("font_fallback", `beat "${key}" line ${JSON.stringify(line)} rendered in ${used.map((u) => u.family).join(", ")}, not the brief's ${brandFamily}`);
      }
      const onPhone = hit.fontPx * (PHONE_WIDTH / (f.width || 1920));
      if (onPhone < MIN_PHONE_FONT_PX) {
        advise("text_small_on_phone", `beat "${key}" line ${JSON.stringify(line)} is ${Math.round(hit.fontPx)}px: about ${onPhone.toFixed(1)}px at phone width`);
      }
    }

    // Remotion unmounts a Sequence outside its window, so a marker placed inside
    // it reports the window the scene really has. HyperFrames hosts stay in the DOM.
    const mount = session.engine.name === "remotion" ? await mountWindow(session, probe, key, beat, fps) : null;

    beats[key] = { copy, firstFrameVisible, firstFrameGraphic, mount };
  }
  return { beats, step: round3(step), advisories: [...advisories.values()], fonts };
}

/**
 * Inspect a project. Resolves with `{ status: "ok", beats, format, ... }`, or
 * `{ status: "unavailable", reason }` when it could not look. Never rejects.
 */
export async function inspectRuntime({ dir, lane, brief, composition }) {
  if (typeof WebSocket === "undefined") {
    return { status: "unavailable", reason: `Node ${process.versions.node} has no built-in WebSocket; the runtime check needs Node 22+` };
  }
  const browserPath = findBrowser(dir, lane);
  if (!browserPath) {
    return { status: "unavailable", reason: "no Chrome found: set MOTIONBRIEF_CHROME, or run doctor.mjs" };
  }

  // Engine helpers may print; --json output must stay parseable.
  const realLog = console.log;
  console.log = console.error;
  const browser = launchBrowser(browserPath);
  let session = null;
  try {
    const ws = await browser.endpoint;
    session = lane === "hyperframes" ? await openHyperFrames(dir, ws, brief) : await openRemotion(dir, ws, brief, composition);
    const seen = await inspectBeats(session, brief);
    return {
      status: "ok",
      ...seen,
      defaultHold: DEFAULT_HOLD,
      format: session.format,
      engine: session.engine,
      browser: { path: browserPath, version: session.page.product },
    };
  } catch (err) {
    return { status: "unavailable", reason: err.message, browser: { path: browserPath } };
  } finally {
    console.log = realLog;
    try {
      session?.page.close();
      session?.close();
    } catch {
      /* already gone */
    }
    browser.cleanup();
  }
}
