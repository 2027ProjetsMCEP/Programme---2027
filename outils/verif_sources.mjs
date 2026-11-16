// Vérifie chaque semaine que les sources de l'appli répondent encore.
// node outils/verif_sources.mjs [--data data.json] [--sortie .] [--archiver] [--timeout 20000]
// Écrit rapport_sources.md (corps du ticket GitHub) et verif_sources.json (résumé lisible par un script).
// Trois catégories :
//   cassé      : 404, 410, domaine introuvable, ou renvoi vers la page d'accueil du site → à remplacer ;
//   à vérifier : 401, 403, 429, 5xx, délai dépassé… souvent un site qui bloque les robots, pas une vraie panne ;
//   ok.
// Pour chaque lien cassé, le script cherche une copie sur archive.org.
// Avec --archiver, il demande aussi une copie archivée des sources ajoutées depuis 30 jours qui n'en ont pas encore.
import fs from "node:fs";
import path from "node:path";

const arg = (k, def) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : def; };
const DATA = arg("--data", "data.json"), OUT = arg("--sortie", "."), TIMEOUT = +arg("--timeout", "20000");
const ARCHIVER = process.argv.includes("--archiver"), MAX_ARCHIVES = 40, PAR_HOTE = 2, WORKERS = 8;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const HEADERS = { "user-agent": UA, "accept": "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8", "accept-language": "fr-FR,fr;q=0.9,en;q=0.5" };

const d = JSON.parse(fs.readFileSync(DATA, "utf8"));
const S = d.sources;
const nom = Object.fromEntries(d.candidats.map(c => [c.id, c.nom]));

/* Où chaque source est utilisée : toute chaîne égale à un identifiant de source est une référence */
const use = {};
const walk = (o, label) => {
  if (typeof o === "string") { if (S[o]) (use[o] = use[o] || new Set()).add(label); return; }
  if (Array.isArray(o)) { o.forEach(x => walk(x, label)); return; }
  if (o && typeof o === "object") Object.values(o).forEach(x => walk(x, label));
};
for (const [k, v] of Object.entries(d)) {
  if (k === "sources") continue;
  if (k === "propositions") v.forEach(p => walk(p, `${p.id} (${nom[p.c] || p.c})`));
  else if (k === "candidats") v.forEach(c => walk(c, `fiche ${c.nom}`));
  else if (k === "sujets") Object.entries(v).forEach(([t, x]) => walk(x, `Comprendre : ${t}`));
  else if (k === "presse") v.forEach(p => walk(p, `brève du ${p.d}`));
  else if (k === "sondages") v.forEach(s => walk(s, `sondage ${s.id}`));
  else walk(v, k);
}

const host = u => { try { return new URL(u).hostname; } catch (e) { return ""; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(u, timeout = TIMEOUT) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(u, { headers: HEADERS, redirect: "follow", signal: ctl.signal });
    try { await r.body?.cancel(); } catch (e) { /* rien */ }
    return { status: r.status, final: r.url };
  } catch (e) {
    const c = e.cause && (e.cause.code || e.cause.name);
    return { status: 0, err: e.name === "AbortError" ? "délai dépassé" : (c || e.message) };
  } finally { clearTimeout(t); }
}

function classer(u, r) {
  if (r.status >= 200 && r.status < 300) {
    try {
      const a = new URL(u), b = new URL(r.final || u);
      const deep = a.pathname.replace(/\/+$/, "").length > 1 || a.search;
      if (deep && b.pathname.replace(/\/+$/, "") === "" && !b.search) return ["cassé", "renvoie vers la page d'accueil du site"];
    } catch (e) { /* rien */ }
    return ["ok", ""];
  }
  if (r.status === 404 || r.status === 410) return ["cassé", `erreur ${r.status}`];
  if (r.status === 0 && /ENOTFOUND|EAI_AGAIN|ERR_NAME/.test(r.err || "")) return ["cassé", "domaine introuvable"];
  if (r.status) return ["à vérifier", `erreur ${r.status}`];
  return ["à vérifier", r.err || "pas de réponse"];
}

async function verifier(u) {
  let r = await get(u);
  let [cat, why] = classer(u, r);
  if (cat !== "ok") { await sleep(4000); const r2 = await get(u); const c2 = classer(u, r2); if (c2[0] === "ok" || (c2[0] === "cassé" && cat !== "cassé")) { r = r2; [cat, why] = c2; } }
  return { cat, why, status: r.status };
}

async function copieArchivee(u) {
  const r = await fetch("https://archive.org/wayback/available?url=" + encodeURIComponent(u), { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20000) }).then(x => x.json()).catch(() => null);
  const c = r && r.archived_snapshots && r.archived_snapshots.closest;
  return c && c.available ? c.url.replace(/^http:/, "https:") : "";
}

/* File d'attente : au plus PAR_HOTE requêtes en même temps sur un même site */
const urls = [...new Set(Object.values(S).map(s => s.u).filter(u => /^https?:\/\//.test(u)))];
const res = {}, busy = {};
let next = 0;
const todo = urls.slice();
async function worker() {
  while (todo.length) {
    const i = todo.findIndex(u => (busy[host(u)] || 0) < PAR_HOTE);
    if (i < 0) { await sleep(200); continue; }
    const u = todo.splice(i, 1)[0], h = host(u);
    busy[h] = (busy[h] || 0) + 1;
    res[u] = await verifier(u);
    busy[h]--; next++;
    if (next % 100 === 0) console.log(`${next}/${urls.length} liens vérifiés`);
  }
}
await Promise.all(Array.from({ length: WORKERS }, worker));

const ids = Object.keys(S).filter(id => res[S[id].u]);
const by = cat => ids.filter(id => res[S[id].u].cat === cat).sort((a, b) => (use[b] ? use[b].size : 0) - (use[a] ? use[a].size : 0) || a.localeCompare(b));
const casses = by("cassé"), averif = by("à vérifier");
for (const id of casses) res[S[id].u].archive = await copieArchivee(S[id].u);

/* Copies archivées des sources récentes (best effort : un échec ne bloque rien) */
let archives = 0;
if (ARCHIVER) {
  const lim = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const recent = ids.filter(id => res[S[id].u].cat === "ok" && String(S[id].d) >= lim);
  for (const id of recent) {
    if (archives >= MAX_ARCHIVES) break;
    if (await copieArchivee(S[id].u)) continue;
    try { const r = await fetch("https://web.archive.org/save/" + S[id].u, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(60000) }); if (r.ok) archives++; } catch (e) { /* rien */ }
    await sleep(8000);
  }
}

/* Rapport */
const today = new Date().toISOString().slice(0, 10);
const esc = t => String(t).replace(/\|/g, "\\|").replace(/\n/g, " ");
const ou = id => { const l = [...(use[id] || [])]; return l.length ? l.slice(0, 4).join(", ") + (l.length > 4 ? ` et ${l.length - 4} autre${l.length - 4 > 1 ? "s" : ""}` : "") : "nulle part (seulement dans la liste des sources)"; };
const ligne = id => { const s = S[id], r = res[s.u]; return `- **${esc(s.p)}**, ${esc(s.d)} : [${esc(s.t)}](${s.u})\n  - identifiant \`${id}\` · ${r.why}\n  - utilisée dans : ${esc(ou(id))}${r.archive !== undefined ? `\n  - copie archivée : ${r.archive ? r.archive : "aucune trouvée"}` : ""}`; };
let md = `Vérification automatique du ${today} : ${urls.length} liens testés.\n\n`;
md += `- **${casses.length}** lien${casses.length > 1 ? "s" : ""} cassé${casses.length > 1 ? "s" : ""}, à remplacer\n- **${averif.length}** à vérifier à la main (souvent un site qui bloque les robots)\n- **${urls.length - casses.length - averif.length}** OK\n`;
if (ARCHIVER) md += `- **${archives}** copie${archives > 1 ? "s" : ""} archivée${archives > 1 ? "s" : ""} demandée${archives > 1 ? "s" : ""} sur archive.org pour des sources récentes\n`;
md += `\n## Liens cassés\n\n${casses.length ? casses.map(ligne).join("\n") : "Aucun."}\n`;
md += `\n## À vérifier à la main\n\nCes sites n'ont pas répondu normalement au robot de vérification. La plupart s'ouvrent sans problème dans un navigateur.\n\n<details><summary>Voir les ${averif.length} liens</summary>\n\n${averif.length ? averif.map(ligne).join("\n") : "Aucun."}\n\n</details>\n`;
md += `\n---\nCorriger une source : remplacer le lien par la même information chez un autre média ou un document officiel, ou par la copie archivée, puis relancer \`node outils/build.js\`. Ne jamais garder une phrase qu'aucune source ne confirme.\n`;
if (md.length > 60000) md = md.slice(0, 59000) + "\n\n… (rapport tronqué : trop de liens à vérifier)\n";
fs.writeFileSync(path.join(OUT, "rapport_sources.md"), md);
fs.writeFileSync(path.join(OUT, "verif_sources.json"), JSON.stringify({ date: today, total: urls.length, casses: casses.map(id => ({ id, u: S[id].u, why: res[S[id].u].why, archive: res[S[id].u].archive || "", use: [...(use[id] || [])] })), a_verifier: averif.map(id => ({ id, u: S[id].u, why: res[S[id].u].why })), archives }, null, 1));
console.log(`${urls.length} liens : ${casses.length} cassés, ${averif.length} à vérifier, ${archives} copies archivées demandées`);
