import dns from 'node:dns/promises';
import net from 'node:net';
import { config } from '../config.js';
import { ScrapeError } from '../errors.js';

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

/** Refuse to fetch internal/private network addresses (SSRF protection). */
async function assertPublicHost(hostname) {
  if (config.allowPrivateHosts) return;
  const host = hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new ScrapeError('BLOCKED_HOST', 'Local and private network addresses cannot be scraped.');
  }
  let addrs;
  if (net.isIP(host)) addrs = [host];
  else {
    try {
      addrs = (await dns.lookup(host, { all: true })).map((a) => a.address);
    } catch {
      throw new ScrapeError('DNS_FAILED', `Could not find the website "${host}". Check the address and try again.`);
    }
  }
  if (addrs.some(isPrivateIp)) {
    throw new ScrapeError('BLOCKED_HOST', 'Local and private network addresses cannot be scraped.');
  }
}

export function looksLikeBotChallenge(headers, body) {
  if (headers?.get?.('cf-mitigated') === 'challenge') return true;
  return /just a moment\.\.\.|attention required! \| cloudflare|verify you are human|are you a robot|request unsuccessful\. incapsula|pardon our interruption/i
    .test((body || '').slice(0, 5000));
}

function statusError(status) {
  if (status === 401) return new ScrapeError('AUTH_REQUIRED', 'This page requires a login. Only publicly accessible content can be scraped.');
  if (status === 403) return new ScrapeError('BLOCKED', 'The website refused access (HTTP 403). It likely blocks automated scraping.');
  if (status === 404 || status === 410) return new ScrapeError('NOT_FOUND', `The page was not found (HTTP ${status}). Check the URL.`);
  if (status === 429) return new ScrapeError('RATE_LIMITED', 'The website is rate-limiting requests (HTTP 429). Try again later.');
  if (status >= 500) return new ScrapeError('SERVER_ERROR', `The website returned a server error (HTTP ${status}). Try again later.`);
  return new ScrapeError('HTTP_ERROR', `The website responded with HTTP ${status}.`);
}

async function readCapped(res, maxBytes) {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel(); break; } // keep what we already have
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function decode(buf, contentType) {
  let charset = /charset=["']?([\w-]+)/i.exec(contentType || '')?.[1];
  if (!charset) {
    const head = buf.subarray(0, 4096).toString('latin1');
    charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder(charset || 'utf-8').decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

/**
 * Fetch a URL politely and safely (timeouts, size cap, per-hop host checks).
 * @returns {Promise<{url: string, status: number, contentType: string, text: string}>}
 */
export async function fetchUrl(url, { accept = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', allowErrorStatus = false } = {}) {
  let current = url;
  for (let hop = 0; hop <= config.maxRedirects; hop++) {
    const u = new URL(current);
    await assertPublicHost(u.hostname);
    let res;
    try {
      res = await fetch(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(config.requestTimeoutMs),
        headers: { 'User-Agent': config.userAgent, Accept: accept, 'Accept-Language': 'en,*;q=0.8' },
      });
    } catch (err) {
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        throw new ScrapeError('TIMEOUT', 'The website took too long to respond.');
      }
      const code = err.cause?.code || '';
      if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') throw new ScrapeError('DNS_FAILED', `Could not find the website "${u.hostname}".`);
      if (code === 'ECONNREFUSED') throw new ScrapeError('UNREACHABLE', 'The website refused the connection.');
      if (/CERT|SSL|TLS/i.test(code)) throw new ScrapeError('TLS_ERROR', 'The website has an invalid security certificate.');
      throw new ScrapeError('UNREACHABLE', 'The website could not be reached.');
    }

    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current).href;
      continue;
    }

    const contentType = res.headers.get('content-type') || '';
    const text = decode(await readCapped(res, config.maxBytes), contentType);

    if (!res.ok) {
      if ((res.status === 403 || res.status === 503) && looksLikeBotChallenge(res.headers, text)) {
        throw new ScrapeError('BLOCKED', 'The website is protected by an anti-bot system and blocked the request.');
      }
      if (allowErrorStatus) return { url: current, status: res.status, contentType, text };
      throw statusError(res.status);
    }
    return { url: current, status: res.status, contentType, text };
  }
  throw new ScrapeError('TOO_MANY_REDIRECTS', 'The website redirected too many times.');
}

export function isHtml(contentType, text) {
  if (/html/i.test(contentType)) return true;
  return /<html|<!doctype html/i.test((text || '').slice(0, 2000));
}
