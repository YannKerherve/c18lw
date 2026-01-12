const SEPARATOR = "/newpage/";

function sendProgress(p) {
    postMessage({ type: "progress", value: p });
}

onmessage = async e => {
    const { target, minWords } = e.data;

    sendProgress(0);

    // 1. Chargement des métadonnées
    const meta = await fetch("sec.txt").then(r => r.json());
    sendProgress(5);

    // 2. Chargement du CSV
    const csvText = await fetch("http://yannkerherve.github.io/c18lw/data.csv").then(r => r.text());
    sendProgress(10);

    // --- META DICTIONARY ---
    const metaDict = {};
    meta.forEach(m => {
        const year = (m.date || "").match(/\d{4}/);
        metaDict[m.filename] = {
            title: m.title || "Inconnu",
            year: year ? parseInt(year[0]) : 0,
            author: m.author || "",
            edition: m.edition || "",
            pays: m.pays || ""
        };
    });

    const lines = csvText.split("\n");
    const totalLines = lines.length;

    let targetShingles = new Map();
    let targetData = null;
    const others = [];

    // Fonction utilitaire pour créer les segments de texte (shingles)
    function makeShingles(text, pdf, page) {
        if (!text) return [];
        const words = text.toLowerCase().match(/\w+/g) || [];
        const shingles = [];
        for (let i = 0; i <= words.length - minWords; i++) {
            const s = words.slice(i, i + minWords).join(" ");
            shingles.push({ key: s, text: s, page, pdf });
        }
        return shingles;
    }

    // --- PARSING DU CSV ---
    for (let i = 0; i < lines.length; i++) {
        const parts = lines[i].split(SEPARATOR);

        // Il faut au moins ID, Titre et une page
        if (parts.length < 3) continue;

        const id = parts[0].replace(/['"]/g,"").trim();
        // parts[1] est le titre inclus dans le CSV, on l'ignore ici car on a sec.txt

        // Est-ce le livre cible ou un autre ?
        const isTarget = (id === target);

        // Si c'est un livre "autre" mais qu'on n'a pas de métadonnées, on l'ignore
        if (!isTarget && !metaDict[id]) continue;

        const currentBookShingles = [];

        // Boucle sur les pages (colonnes 2 à N)
        // parts[2] = Page 1, parts[3] = Page 2, etc.
        for (let col = 2; col < parts.length; col++) {
            const pageNum = col - 1; // La colonne 2 correspond à la page 1
            const pageText = parts[col];

            // On génère les shingles pour cette page spécifique
            const sh = makeShingles(pageText, id, pageNum);

            if (isTarget) {
                // Pour la cible, on stocke dans la Map globale pour recherche rapide
                // On garde la première occurrence trouvée pour chaque phrase
                sh.forEach(s => {
                    if (!targetShingles.has(s.key)) {
                        targetShingles.set(s.key, s);
                    }
                });
            } else {
                // Pour les autres, on accumule dans un tableau temporaire
                currentBookShingles.push(...sh);
            }
        }

        if (isTarget) {
            targetData = {
                id,
                year: metaDict[id]?.year || 0,
                title: metaDict[id]?.title || "Target"
            };
        } else {
            others.push({
                id,
                ...metaDict[id],
                shingles: currentBookShingles
            });
        }

        if (i % 20 === 0) sendProgress(10 + Math.floor((i/totalLines)*50));
    }

    // --- COMPARAISON ---
    const connections = [];
    const totalOthers = others.length;

    // Sécurité si la cible n'est pas trouvée
    if (!targetData) {
        postMessage({
            target: { id: target, year: 0, title: "Non trouvé" },
            connections: [],
            meta
        });
        return;
    }

    for (let i = 0; i < others.length; i++) {
        const book = others[i];
        const commons = [];

        for (let s of book.shingles) {
            // Si le texte de ce livre (s) existe dans la cible
            if (targetShingles.has(s.key)) {
                const targetMatch = targetShingles.get(s.key);

                commons.push({
                    text: s.text,
                    // Infos du livre CIBLE (pdf1)
                    pdf1: targetData.id,
                    page1: targetMatch.page,
                    // Infos du livre SOURCE (pdf2)
                    pdf2: book.id,
                    page2: s.page
                });
            }
        }

        if (commons.length > 0) {
            connections.push({
                id: book.id,
                title: book.title,
                year: book.year,
                weight: commons.length,
                direction: book.year <= targetData.year ? "IN" : "OUT",
                commons
            });
        }
        if (i % 5 === 0) sendProgress(60 + Math.floor((i/totalOthers)*40));
    }

    sendProgress(100);

    postMessage({
        target: targetData,
        connections,
        meta
    });
};
