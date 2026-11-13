
const Parser = require("rss-parser");
const crypto = require("node:crypto");

const parser = new Parser({ timeout: 12000 });

const SOURCES = [
  {
    category: "internacional",
    name: "BBC Mundo",
    url: "https://feeds.bbci.co.uk/mundo/rss.xml"
  },
  {
    category: "ciencia",
    name: "BBC Science",
    url: "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml"
  },
  {
    category: "medicina",
    name: "BBC Health",
    url: "https://feeds.bbci.co.uk/news/health/rss.xml"
  },
  {
    category: "tecnologia",
    name: "BBC Technology",
    url: "https://feeds.bbci.co.uk/news/technology/rss.xml"
  }
];

// Estas fuentes son un punto de partida.
// Se podrán agregar feeds de Costa Rica y videojuegos
// una vez comprobados sus enlaces RSS.

const BLOCKED = [
  /patrocinad[oa]/i,
  /sponsored/i,
  /hor[oó]scopo/i,
  /astrolog[ií]a/i,
  /clickbait/i,
  /celebridad(?:es)?/i
];

const IMPORTANT = [
  /elecci[oó]n|gobierno|congreso/i,
  /salud|hospital|vacuna|enfermedad/i,
  /investigaci[oó]n|cient[ií]fic/i,
  /econom[ií]a|inflaci[oó]n/i,
  /seguridad|emergencia|terremoto/i,
  /tecnolog[ií]a|inteligencia artificial/i,
  /videojuego|consola|lanzamiento/i
];

function cleanURL(link) {
  try {
    const url = new URL(link);
    if (!["http:", "https:"].includes(url.protocol)) {
      return null;
    }

    url.hash = "";

    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_|^fbclid$|^gclid$/i.test(key)) {
        url.searchParams.delete(key);
      }
    }

    return url.toString();
  } catch {
    return null;
  }
}

function normalize(text) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function hash(text) {
  return crypto
    .createHash("sha256")
    .update(text)
    .digest("hex");
}

function evaluate(article, filter = "equilibrado") {
  const text = `${article.title} ${article.summary}`;

  if (BLOCKED.some(pattern => pattern.test(text))) {
    return 0;
  }

  let score = 40;

  if (IMPORTANT.some(pattern => pattern.test(text))) {
    score += 25;
  }

  if (article.summary.length >= 80) {
    score += 10;
  }

  const ageHours =
    (Date.now() - article.published) / 3600000;

  if (ageHours <= 12) score += 15;
  else if (ageHours <= 24) score += 10;
  else if (ageHours <= 48) score += 5;

  // Es una clasificación heurística, no
  // una verificación independiente de hechos.
  return Math.min(100, score);
}

async function getNews({
  category = "todas",
  filter = "equilibrado",
  seen = []
} = {}) {
  const thresholds = {
    estricto: 75,
    equilibrado: 55,
    amplio: 40
  };

  const threshold = thresholds[filter] ?? 55;
  const results = [];

  for (const source of SOURCES) {
    if (
      category !== "todas" &&
      category !== source.category
    ) continue;

    try {
      const feed = await parser.parseURL(source.url);

      for (const item of feed.items || []) {
        const title = String(item.title || "").trim();
        const url = cleanURL(item.link);
        const published = Date.parse(
          item.isoDate || item.pubDate || ""
        );

        if (
          !title ||
          !url ||
          !Number.isFinite(published)
        ) continue;

        const age = Date.now() - published;

        if (age < 0 || age > 48 * 3600000) continue;

        const summary = String(
          item.contentSnippet || item.content || ""
        ).replace(/<[^>]*>/g, "").slice(0, 500);

        const article = {
          title,
          url,
          published,
          summary,
          source: source.name,
          category: source.category,
          id: hash(url),
          titleId: hash(normalize(title))
        };

        if (
          seen.includes(article.id) ||
          seen.includes(article.titleId)
        ) continue;

        article.score = evaluate(article, filter);

        if (article.score >= threshold) {
          results.push(article);
        }
      }
    } catch (error) {
      console.error(
        `RSS ${source.name}: ${error.message}`
      );
    }
  }

  const unique = [];
  const keys = new Set();

  for (const article of results.sort(
    (a, b) => b.score - a.score ||
      b.published - a.published
  )) {
    if (
      keys.has(article.id) ||
      keys.has(article.titleId)
    ) continue;

    keys.add(article.id);
    keys.add(article.titleId);
    unique.push(article);
  }

  return unique;
}

module.exports = {
  getNews,
  SOURCES
};
