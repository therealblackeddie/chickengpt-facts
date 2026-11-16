#!/usr/bin/env node
// ChickenGPT fact submission validator. No dependencies. Node 18+.
//
//   node scripts/validate.mjs --base <main facts.json> --head <proposed facts.json>
//        [--changed <tsv of filename TAB status>] [--check-urls] [--site https://chickengpt.net/]
//
// Treats every submitted string as untrusted data. It is parsed, measured and compared,
// never evaluated. Exit code 1 means the pull request should not be merged as is.

import fs from "node:fs";
import dns from "node:dns/promises";
import net from "node:net";

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const flag = n => args.includes(n);

const errors = [];
const warnings = [];
const rows = [];
const err = m => errors.push(m);
const warn = m => warnings.push(m);

const MAX_FILE = 256 * 1024;
const MAX_FACTS = 500;
const MAX_NEW = 5;
const KEYS = new Set(["id", "fact", "quip", "sources", "submitted_by", "submitted_on", "notes"]);
const REQUIRED = ["id", "fact", "sources", "submitted_by", "submitted_on"];
const CHICKEN = /\b(chickens?|hens?|roosters?|cocks?|cockerels?|chicks?|pullets?|capons?|bantams?|broilers?|layers?|poultry|eggs?|eggshells?|yolks?|junglefowl|fowl|gallus|coops?|flocks?|clutch|brood\w*|incubat\w*|hatch\w*|comb|wattles?|gizzards?|plumage|feathers?|nugget\w*)\b/i;
const BAD_CHARS = /[<>{}`\u0000-\u001f\u007f\u2028\u2029]/;
const HAS_LINK = /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|us|ai|gov|edu)\b/i;
const INSTRUCTIONS = /\b(ignore|disregard|forget)\b.{0,40}\b(instructions?|prompts?|rules)\b|\b(system|developer)\s+(prompt|message)\b|\b(approve|merge|accept)\s+(this|the)\s+(pr|pull\s+request|submission|fact)\b|\byou\s+are\s+(now\s+)?(an?\s+)?(ai|assistant|language\s+model|chatgpt|claude)\b/i;
const SHORTENERS = new Set(["bit.ly", "t.co", "tinyurl.com", "goo.gl", "share.google", "ow.ly", "is.gd", "buff.ly", "rebrand.ly", "cutt.ly", "shorturl.at", "tiny.cc", "lnkd.in", "rb.gy", "t.ly", "s.id"]);
const NO_SELF = [/(^|\.)chickengpt\.net$/, /(^|\.)chat\.openai\.com$/, /(^|\.)chatgpt\.com$/, /(^|\.)gemini\.google\.com$/, /(^|\.)claude\.ai$/, /(^|\.)perplexity\.ai$/];
const STOP = new Set("a an the and or but of to in on at by for with from as is are was were be been it its that this these those than then there their they them he she his her you your we our i me my do did does have has had not no so if into over under about after before more most less very just can could would should may might will also out up down only one two three chickens chicken hen hens rooster roosters chick chicks egg eggs know".split(" "));

function readJson(path, label) {
  let txt;
  try { txt = fs.readFileSync(path, "utf8"); } catch { err(`${label}: can't read ${path}`); return null; }
  if (Buffer.byteLength(txt) > MAX_FILE) { err(`${label}: file is larger than ${MAX_FILE / 1024} KB`); return null; }
  if (!txt.trim()) { err(`${label}: facts.json is missing or empty`); return null; }
  try { return JSON.parse(txt); } catch (e) { err(`${label}: not valid JSON (${e.message})`); return null; }
}

function text(f, key, min, max, where, required = true) {
  const v = f[key];
  if (v === undefined) { if (required) err(`${where}: "${key}" is required`); return; }
  if (typeof v !== "string") { err(`${where}: "${key}" must be a string`); return; }
  if (v !== v.trim()) err(`${where}: "${key}" has leading or trailing spaces`);
  if (v.length < min || v.length > max) err(`${where}: "${key}" must be ${min} to ${max} characters (it's ${v.length})`);
  if (BAD_CHARS.test(v)) err(`${where}: "${key}" contains a forbidden character (< > { } backtick or a control/line-break character)`);
}

function isPrivateHost(h) {
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".localhost")) return true;
  if (net.isIP(h.replace(/^\[|\]$/g, ""))) return true; // no bare IPs at all
  return !h.includes(".");
}

function checkUrl(u, where) {
  if (typeof u !== "string" || u.length > 500) { err(`${where}: url must be a string up to 500 characters`); return null; }
  let x;
  try { x = new URL(u); } catch { err(`${where}: "${u}" is not a valid URL`); return null; }
  if (x.protocol !== "https:") err(`${where}: url must start with https://`);
  if (x.username || x.password) err(`${where}: url must not contain credentials`);
  if (x.port && x.port !== "443") err(`${where}: url must not use a custom port`);
  const host = x.hostname.toLowerCase();
  if (isPrivateHost(host)) err(`${where}: url host "${host}" is not a public domain name`);
  if (SHORTENERS.has(host)) err(`${where}: link shorteners aren't allowed (${host}); link the real page`);
  if (NO_SELF.some(re => re.test(host))) err(`${where}: ${host} can't be a source (no self-citation or AI chat transcripts)`);
  return x;
}

function checkFact(f, i, idSeen) {
  const where = `fact #${i + 1}${f && typeof f.id === "string" ? ` (${f.id})` : ""}`;
  if (!f || typeof f !== "object" || Array.isArray(f)) { err(`${where}: must be an object`); return; }
  for (const k of Object.keys(f)) if (!KEYS.has(k)) err(`${where}: unknown field "${k}"`);
  if (typeof f.id === "string") {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(f.id) || f.id.length < 3 || f.id.length > 60) err(`${where}: id must be lowercase-kebab-case, 3 to 60 characters`);
    if (idSeen.has(f.id)) err(`${where}: id "${f.id}" is used more than once`);
    idSeen.add(f.id);
  } else if (f.id === undefined) err(`${where}: "id" is required`);
  else err(`${where}: id must be a string`);
  text(f, "fact", 30, 280, where);
  text(f, "quip", 1, 140, where, false);
  text(f, "submitted_by", 2, 80, where);
  text(f, "notes", 1, 300, where, false);
  for (const k of ["fact", "quip", "submitted_by"]) {
    if (typeof f[k] === "string" && HAS_LINK.test(f[k])) err(`${where}: "${k}" must not contain links or web addresses; put them in sources`);
  }
  for (const k of ["fact", "quip", "submitted_by", "notes"]) {
    if (typeof f[k] === "string" && INSTRUCTIONS.test(f[k])) err(`${where}: "${k}" reads like instructions to an AI or the reviewer. Submissions are data only`);
  }
  if (typeof f.fact === "string" && !CHICKEN.test(f.fact)) err(`${where}: the fact doesn't mention chickens (or hens, roosters, chicks, eggs, poultry...)`);
  if (typeof f.submitted_on === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(f.submitted_on);
    const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (!m || isNaN(d) || d.toISOString().slice(0, 10) !== f.submitted_on) err(`${where}: submitted_on must be a real date as YYYY-MM-DD`);
    else if (d.getTime() > Date.now() + 2 * 86400000) err(`${where}: submitted_on is in the future`);
    else if (d.getUTCFullYear() < 2024) err(`${where}: submitted_on looks wrong (before 2024)`);
  } else if (f.submitted_on === undefined) err(`${where}: "submitted_on" is required`);
  else err(`${where}: submitted_on must be a string`);
  if (f.sources === undefined) { err(`${where}: "sources" is required`); return; }
  if (!Array.isArray(f.sources) || f.sources.length < 1 || f.sources.length > 4) { err(`${where}: sources must be a list of 1 to 4 items`); return; }
  const seen = new Set();
  f.sources.forEach((s, j) => {
    const sw = `${where} source ${j + 1}`;
    if (!s || typeof s !== "object" || Array.isArray(s)) { err(`${sw}: must be an object with url and title`); return; }
    for (const k of Object.keys(s)) if (k !== "url" && k !== "title") err(`${sw}: unknown field "${k}"`);
    text(s, "title", 3, 150, sw);
    const x = checkUrl(s.url, sw);
    if (x) { if (seen.has(x.href)) err(`${sw}: same link listed twice`); seen.add(x.href); }
  });
}

const norm = s => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const words = s => new Set(norm(s).split(" ").filter(w => w.length > 2 && !STOP.has(w)));
function similarity(a, b) {
  const A = words(a), B = words(b);
  if (A.size < 3 || B.size < 3) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  // overlap coefficient: catches a short fact restating part of a longer one
  return inter / Math.min(A.size, B.size);
}
const DUP = 0.6;

async function siteStrings(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { "user-agent": "chickengpt-facts-validator" } });
    if (!r.ok) { warn(`couldn't load ${url} for the duplicate check (HTTP ${r.status})`); return []; }
    const html = await r.text();
    const out = [];
    for (const m of html.matchAll(/"((?:[^"\\\n]|\\.){40,400})"/g)) out.push(m[1].replace(/\\"/g, '"'));
    return out;
  } catch (e) { warn(`couldn't load ${url} for the duplicate check (${e.message})`); return []; }
}

async function probe(u) {
  const x = new URL(u);
  try { await dns.lookup(x.hostname); } catch { return { fatal: true, msg: `domain ${x.hostname} doesn't resolve` }; }
  const tryOnce = async method => {
    const r = await fetch(u, { method, redirect: "follow", signal: AbortSignal.timeout(12000), headers: { "user-agent": "Mozilla/5.0 (compatible; chickengpt-facts-validator; +https://github.com/therealblackeddie/chickengpt-facts)", accept: "text/html,application/pdf,*/*" } });
    try { await r.body?.cancel(); } catch {}
    return r.status;
  };
  try {
    let s = await tryOnce("HEAD");
    if (s === 405 || s === 403 || s === 400 || s === 501) s = await tryOnce("GET");
    if (s === 404 || s === 410) return { fatal: true, msg: `HTTP ${s} (page not found)` };
    if (s >= 400) return { fatal: false, msg: `HTTP ${s} (site may block bots; reviewer should open it)` };
    return { ok: true, msg: `HTTP ${s}` };
  } catch (e) { return { fatal: false, msg: `couldn't load (${e.cause?.code || e.name}); reviewer should open it` }; }
}

const mdEsc = s => String(s).replace(/[|\\`*_<>\[\]]/g, c => "\\" + c);

(async () => {
  const basePath = opt("--base");
  const headPath = opt("--head");
  if (!headPath) { console.error("usage: validate.mjs --base main.json --head proposed.json [--changed files.tsv] [--check-urls] [--site URL]"); process.exit(2); }

  if (opt("--changed")) {
    const lines = fs.readFileSync(opt("--changed"), "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      const [file, status] = line.split("\t");
      if (file !== "facts.json") err(`this pull request changes "${file}" (${status || "changed"}). Fact submissions may only change facts.json`);
      else if (status === "removed") err("this pull request deletes facts.json");
    }
    if (!lines.length) err("this pull request doesn't change any files");
  }

  const base = basePath ? readJson(basePath, "main") : { facts: [] };
  const head = readJson(headPath, "proposed");
  const headOk = head && typeof head === "object" && !Array.isArray(head) && Array.isArray(head.facts);
  if (head && !headOk) err("proposed: top level must be an object with a \"facts\" list");
  if (headOk) for (const k of Object.keys(head)) if (k !== "facts" && k !== "about") err(`proposed: unknown top-level field "${k}"`);
  if (headOk && base && basePath && head.about !== base.about) err("proposed: don't change the \"about\" text");

  let added = [];
  if (headOk) {
    if (head.facts.length > MAX_FACTS) err(`proposed: more than ${MAX_FACTS} facts in the file`);
    const idSeen = new Set();
    head.facts.forEach((f, i) => checkFact(f, i, idSeen));

    const baseFacts = base && Array.isArray(base.facts) ? base.facts : [];
    const headById = new Map(head.facts.filter(f => f && typeof f.id === "string").map(f => [f.id, f]));
    for (const bf of baseFacts) {
      const hf = headById.get(bf.id);
      if (!hf) err(`existing fact "${bf.id}" was removed. Submissions may only add facts`);
      else if (JSON.stringify(hf) !== JSON.stringify(bf)) err(`existing fact "${bf.id}" was changed. Submissions may only add facts`);
    }
    const baseIds = new Set(baseFacts.map(f => f.id));
    if (head.facts.slice(0, baseFacts.length).some((f, i) => !f || f.id !== baseFacts[i].id)) err("existing facts were reordered. Add new facts at the end of the list");
    added = head.facts.filter(f => f && typeof f === "object" && !Array.isArray(f) && !baseIds.has(f.id));
    if (basePath) {
      if (added.length === 0) err("no new facts were added");
      if (added.length > MAX_NEW) err(`${added.length} new facts in one pull request. The limit is ${MAX_NEW}`);
    }

    // duplicates
    const site = opt("--site") ? await siteStrings(opt("--site")) : [];
    const pool = [...baseFacts.map(f => ({ t: f.fact, from: `existing fact "${f.id}"` })), ...site.map(t => ({ t, from: "chickengpt.net" }))];
    added.forEach((f, i) => {
      if (typeof f.fact !== "string") return;
      for (const p of pool) {
        if (typeof p.t !== "string") continue;
        const s = similarity(f.fact, p.t);
        if (s >= DUP) { err(`"${f.id}" looks like a duplicate of ${p.from}: "${p.t.slice(0, 120)}" (${Math.round(s * 100)}% word overlap)`); break; }
      }
      for (let j = 0; j < i; j++) {
        if (typeof added[j].fact === "string" && similarity(f.fact, added[j].fact) >= DUP) err(`"${f.id}" duplicates "${added[j].id}" in the same pull request`);
      }
    });

    // sources
    for (const f of added.slice(0, MAX_NEW)) {
      const srcs = Array.isArray(f.sources) ? f.sources.slice(0, 4) : [];
      for (const s of srcs) {
        let status = "not checked";
        let okUrl = false;
        try { okUrl = !!(s && typeof s.url === "string" && new URL(s.url).protocol === "https:"); } catch {}
        if (flag("--check-urls") && okUrl) {
          const p = await probe(s.url);
          status = p.msg;
          if (p.fatal) err(`"${f.id}" source ${s.url}: ${p.msg}`);
          else if (!p.ok) warn(`"${f.id}" source ${s.url}: ${p.msg}`);
        }
        rows.push([f.id, s && s.url, status]);
      }
    }
  }

  // report
  const out = [];
  out.push(errors.length ? "## Fact submission check: FAILED" : "## Fact submission check: passed");
  out.push("");
  out.push("A pass only means the format is right. A human still has to confirm each fact against its sources.");
  out.push("");
  if (added.length) {
    out.push("### New facts");
    for (const f of added) {
      out.push(`- **${mdEsc(f.id)}**: ${mdEsc(f.fact ?? "(missing)")}${f.quip ? `  \n  _quip:_ ${mdEsc(f.quip)}` : ""}  \n  _submitted by:_ ${mdEsc(f.submitted_by ?? "(missing)")}`);
    }
    out.push("");
  }
  if (rows.length) {
    out.push("### Sources");
    out.push("| Fact | URL | Link check |");
    out.push("|---|---|---|");
    for (const [id, url, st] of rows) out.push(`| ${mdEsc(id)} | ${mdEsc(url)} | ${mdEsc(st)} |`);
    out.push("");
  }
  if (errors.length) { out.push("### Problems"); for (const e of errors) out.push(`- ${mdEsc(e)}`); out.push(""); }
  if (warnings.length) { out.push("### Warnings"); for (const w of warnings) out.push(`- ${mdEsc(w)}`); out.push(""); }
  const report = out.join("\n");
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + "\n");
  if (process.env.GITHUB_ACTIONS) for (const e of errors) console.log(`::error::${e.replace(/[\r\n%]/g, " ")}`);
  process.exit(errors.length ? 1 : 0);
})();
