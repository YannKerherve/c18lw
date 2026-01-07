const params = new URLSearchParams(location.search);
const pdf = params.get("pdf");

const worker = new Worker("worker.js");
const slider = document.getElementById("threshold");
const label  = document.getElementById("thresholdLabel");

let ALL_CONNECTIONS = [];
let TARGET = null;
let META = {};
let NETWORK = null;

function truncateTitle(title, maxWords = 15) {
    if (!title) return "";
    const words = title.split(/\s+/);
    if (words.length <= maxWords) return title;
    return words.slice(0, maxWords).join(" ") + "…";
}

// Slider
slider.addEventListener("input", e => {
    const value = +e.target.value;
    label.textContent = `${value} %`;
    draw(value);
});

// Worker messages
worker.onmessage = e => {
    if (e.data.type === "progress") {
        const pElem = document.getElementById("progress");
        if(pElem) pElem.textContent = e.data.value;
        return;
    }

    const loader = document.getElementById("loader");
    if(loader) loader.style.display = "none";

    const sBox = document.getElementById("sliderBox");
    if(sBox) sBox.style.display = "block";

    TARGET = e.data.target;
    ALL_CONNECTIONS = e.data.connections;
    META = {};
    if(e.data.meta) {
        e.data.meta.forEach(m => META[m.filename] = m);
    }

    draw(0);

    const panel = document.getElementById("infoPanel");
    if(panel) {
        panel.style.display = "block";
        panel.innerHTML = `<p class="text-sm text-gray-400">Sélectionnez un ouvrage sur le schéma</p>`;
    }
};

worker.postMessage({ target: pdf, minWords: 20 });

// Draw network
function draw(threshold) {
    const nodes = [];
    const edges = [];

    if(!ALL_CONNECTIONS || ALL_CONNECTIONS.length === 0) {
        if(TARGET) {
            nodes.push({
                id: TARGET.id,
                label: `${TARGET.id}\n(${TARGET.year})`,
                x: 0, y: 0, fixed: true, color: "#374151", size: 45,
                font: { color: "white", size: 18 }
            });
            updateNetwork({nodes, edges});
        }
        return;
    }

    const totalSlots = Math.max(...ALL_CONNECTIONS.map(c => c.weight));

    nodes.push({
        id: TARGET.id,
        label: `${TARGET.id}\n(${TARGET.year})`,
        x: 0, y: 0, fixed: true, color: "#374151", size: 45,
        font: { color: "white", size: 18 }
    });

    const filtered = ALL_CONNECTIONS.filter(c => (c.weight / totalSlots)*100 >= threshold);
    const R = 550;
    const n = filtered.length;

    filtered.sort((a,b)=>a.year-b.year);

    filtered.forEach((c,i)=>{
        const angle = 2*Math.PI*i/n;
        const x = R*Math.cos(angle);
        const y = R*Math.sin(angle);
        const percent = Math.round((c.weight/totalSlots)*100);

        const edgeColor = c.year === TARGET.year ? "#9ca3af" :
                          c.year < TARGET.year ? "#2563eb" : "#16a34a";

        nodes.push({
            id: c.id,
            label: `${c.id} (${c.year})\n${percent} %`,
            x, y,
            fixed: true,
            size: 26,
            color: "#e5e7eb",
            font: { color: "#111827", size: 14 }
        });

        edges.push({
            from: c.year <= TARGET.year ? c.id : TARGET.id,
            to:   c.year <= TARGET.year ? TARGET.id : c.id,
            arrows: "to",
            width: Math.min(c.weight/5,8),
            color: edgeColor
        });
    });

    updateNetwork({ nodes, edges });
}

function updateNetwork(data) {
    const container = document.getElementById("network");
    if(!NETWORK){
        NETWORK = new vis.Network(container, data, { physics: false, interaction: { hover: true } });
        NETWORK.on("selectNode", params => {
            if(params.nodes.length>0) showInfo(params.nodes[0]);
        });
        NETWORK.on("selectEdge", params => {
            if(params.edges.length>0){
                const edge = NETWORK.body.data.edges.get(params.edges[0]);
                const pdfId = edge.from === TARGET.id ? edge.to : edge.from;
                showInfo(pdfId);
            }
        });
    } else {
        NETWORK.setData(data);
    }
}

function showInfo(pdfId){
    const panel = document.getElementById("infoPanel");
    panel.style.display = "block";

    if(TARGET && pdfId === TARGET.id) {
        panel.innerHTML = `<h2 class="text-2xl font-semibold mb-4 text-[#333333]">${truncateTitle(TARGET.title)}</h2><p>Ouvrage de référence (Cible).</p>`;
        return;
    }

    const meta = META[pdfId];
    const connection = ALL_CONNECTIONS.find(c => c.id === pdfId);

    if(!meta || !connection){
        panel.innerHTML = "<p>Données indisponibles.</p>";
        return;
    }

    // --- LOGIQUE DE REGROUPEMENT PAR PAGES ---
    const groups = {};

    connection.commons.forEach(c => {
        // On crée une clé unique pour la paire de pages (ex: "12-45")
        const key = `${c.page1}-${c.page2}`;

        if (!groups[key]) {
            groups[key] = {
                pdf1: c.pdf1,
                page1: c.page1,
                pdf2: c.pdf2,
                page2: c.page2,
                snippets: [] // Liste des textes trouvés sur cette paire de pages
            };
        }
        groups[key].snippets.push(c.text);
    });
    // ------------------------------------------

    let html = `
        <h2 class="text-2xl font-semibold mb-4 text-[#333333]">
            ${truncateTitle(meta.title, 15)}
        </h2>
        <div class="space-y-1 text-sm text-[#374151]">
            <p><strong>Auteur:</strong> ${meta.author || "—"}</p>
            <p><strong>Date:</strong> ${meta.date || ""}</p>
            <p><strong>Fichier:</strong> ${meta.filename}</p>
        </div>
        <hr class="my-6">
        <h3 class="text-lg font-semibold mb-4">
            Pages correspondantes (${Object.keys(groups).length})
        </h3>
    `;

    // On itère sur les GROUPES au lieu des correspondances individuelles
    Object.values(groups).forEach(group => {
        // On prend le premier snippet pour la recherche (query)
        // Les snippets étant souvent redondants ou chevauchants, on en affiche quelques-uns
        const mainSnippet = group.snippets[0];
        const safeQuery = encodeURIComponent(mainSnippet);
        const url = `ocr2pdf.htm?pdf1=${group.pdf1}&pdf2=${group.pdf2}&query=${safeQuery}&pagepdf1=${group.page1}&pagepdf2=${group.page2}#`;

        // On prépare un aperçu du texte (les 3 premiers max pour ne pas surcharger)
        const textPreview = group.snippets.slice(0, 3).map(t => `“${t}”`).join(" <br> ");
        const moreCount = group.snippets.length - 3;
        const moreLabel = moreCount > 0 ? `<span class="text-xs text-gray-400 mt-1 block">(+ ${moreCount} other elements on that page)</span>` : "";

        html += `
            <div class="mb-4 p-4 bg-[#f5f5f5] rounded-xl border border-gray-200">

                <div class="font-bold text-gray-700 mb-2 border-b border-gray-300 pb-1 flex justify-between">
                     <span>P.${group.page1} (Target)</span>
                     <span>↔</span>
                     <span>P.${group.page2} (Source)</span>
                </div>

                <div class="italic text-sm mb-3 text-gray-600 max-h-32 overflow-y-auto">
                    ${textPreview}
                    ${moreLabel}
                </div>

                <div class="text-right">
                    <a href="${url}"
                       target="_blank"
                       class="inline-block px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition duration-150 ease-in-out shadow-sm text-center no-underline">
                        See similarities
                    </a>
                </div>
            </div>
        `;
    });

    panel.innerHTML = html;
}
