// Reconstruit index.html à partir du gabarit et de data.json : node outils/build.js (depuis la racine du dépôt)
const fs = require("fs");
const t = fs.readFileSync("outils/app_template.html", "utf8");
const d = JSON.parse(fs.readFileSync("data.json", "utf8"));
fs.writeFileSync("index.html", t.replace("__SEED__", () => JSON.stringify(d).replace(/</g, "\\u003c")));
console.log("index.html :", fs.statSync("index.html").size, "octets ;", d.candidats.length, "candidats,", d.propositions.length, "propositions");
// Stories : l'écran « candidats » rédigé à la main n'est montré que s'il couvre exactement les propositions du sujet
for (const [k, S] of Object.entries(d.sujets || {})) {
  const s4 = S.story && S.story.s4; if (!s4) continue;
  const now = d.propositions.filter(p => p.th === k).map(p => p.id).sort(), was = (s4.ids || []).slice().sort();
  if (now.join() !== was.join()) console.log(`⚠ Story « ${k} » : les propositions ont changé (${now.filter(x => !was.includes(x)).join(", ") || "-"} en plus, ${was.filter(x => !now.includes(x)).join(", ") || "-"} en moins). L'appli montre des exemples au hasard tant que l'écran n'est pas revu.`);
}
