/* Currency conversion for the report.
 *
 * The console reads whatever currency the packet printed. A manager asking
 * "how much did we approve this month" wants one number, so the report adds
 * them up in dirhams. That is only honest if the rate used is stated, so the
 * rate table and the day it was taken travel with every converted figure and
 * are printed under the ribbon.
 *
 * The rates below are a fallback so the page works out of the box. Set
 * FX_RATES in the environment to keep them current without a deploy:
 *
 *   FX_RATES="USD:3.6725,EUR:4.1832,GBP:4.869"
 *   FX_AS_OF="2026-09-28"
 *
 * A currency with no rate is never guessed at. It is left out of the
 * converted total and reported as left out, because a total that quietly
 * drops money is worse than one that says what it could not add.
 */

'use strict';

const BASE = 'AED';

/* AED is pegged to the dollar at 3.6725, so that one does not drift. The
   others are mid market rates read on the date below. */
const FALLBACK_RATES = {
  AED: 1,
  USD: 3.6725,
  EUR: 4.1832,
  GBP: 4.869
};
const FALLBACK_AS_OF = '2026-09-28';

/** Symbols and spellings the extraction step can print, to ISO codes. */
const ALIASES = {
  $: 'USD',
  US$: 'USD',
  'US＄': 'USD',
  USD: 'USD',
  '€': 'EUR',
  EUR: 'EUR',
  '£': 'GBP',
  GBP: 'GBP',
  'د.إ': 'AED',
  'AED': 'AED',
  DH: 'AED',
  DHS: 'AED',
  'AED.': 'AED'
};

/** 'unlabelled' and anything unrecognised come back null, never a guess. */
function normalize(symbol) {
  if (symbol === null || symbol === undefined) return null;
  const raw = String(symbol).trim();
  if (!raw || raw.toLowerCase() === 'unlabelled') return null;
  if (ALIASES[raw]) return ALIASES[raw];
  const upper = raw.toUpperCase();
  if (ALIASES[upper]) return ALIASES[upper];
  if (/^[A-Z]{3}$/.test(upper)) return upper;
  return null;
}

function parseEnvRates(raw) {
  const out = {};
  String(raw || '')
    .split(/[,\n;]+/)
    .forEach(function (pair) {
      const bits = pair.split(':');
      if (bits.length !== 2) return;
      const code = normalize(bits[0]);
      const rate = Number(String(bits[1]).trim());
      if (!code || !isFinite(rate) || rate <= 0) return;
      out[code] = rate;
    });
  return out;
}

const envRates = parseEnvRates(process.env.FX_RATES);
const fromEnv = Object.keys(envRates).length > 0;

const RATES = Object.assign({}, FALLBACK_RATES, envRates);
RATES[BASE] = 1;

const AS_OF = (process.env.FX_AS_OF || '').trim() || (fromEnv ? null : FALLBACK_AS_OF);

/**
 * An amount in `currency`, in dirhams. null when there is no rate for it, so
 * the caller can count it as left out rather than as zero.
 */
function toBase(amount, currency) {
  if (typeof amount !== 'number' || !isFinite(amount)) return null;
  const code = normalize(currency);
  if (!code) return null;
  const rate = RATES[code];
  if (!isFinite(rate) || rate <= 0) return null;
  return amount * rate;
}

/** Can this row be added to the dirham total at all. */
function convertible(currency) {
  const code = normalize(currency);
  return Boolean(code && RATES[code]);
}

/** What the page prints under the ribbon so a converted figure is never
    mistaken for money that was actually in dirhams. */
function describe() {
  return {
    base: BASE,
    rates: Object.assign({}, RATES),
    asOf: AS_OF,
    source: fromEnv ? 'configured' : 'built in'
  };
}

module.exports = {
  BASE: BASE,
  normalize: normalize,
  toBase: toBase,
  convertible: convertible,
  describe: describe,
  rates: RATES
};
