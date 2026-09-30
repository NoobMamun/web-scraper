export function toJson(data) {
  const out = {
    site: data.site,
    scrapedAt: data.scrapedAt,
    pagesScanned: data.pagesScanned,
    stats: {
      sections: data.sections.length,
      items: data.sections.reduce((n, s) => n + s.items.length, 0),
    },
    sections: data.sections.map((s) => ({ name: s.name, itemCount: s.items.length, items: s.items })),
  };
  return Buffer.from(JSON.stringify(out, null, 2), 'utf8');
}
