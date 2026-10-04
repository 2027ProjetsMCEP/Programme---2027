// Reconstruit index.html à partir du gabarit et de data.json : node outils/build.js (depuis la racine du dépôt)
const fs = require("fs");
const t = fs.readFileSync("outils/app_template.html", "utf8");
const d = JSON.parse(fs.readFileSync("data.json", "utf8"));
fs.writeFileSync("index.html", t.replace("__SEED__", () => JSON.stringify(d).replace(/</g, "\\u003c")));
console.log("index.html :", fs.statSync("index.html").size, "octets ;", d.candidats.length, "candidats,", d.propositions.length, "propositions");
