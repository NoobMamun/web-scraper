export const COLUMNS = [
  { key: 'section', header: 'Section', width: 22 },
  { key: 'title', header: 'Title', width: 50 },
  { key: 'description', header: 'Description', width: 60 },
  { key: 'date', header: 'Date', width: 18 },
  { key: 'author', header: 'Author', width: 22 },
  { key: 'url', header: 'URL', width: 45 },
  { key: 'image', header: 'Image', width: 35 },
  { key: 'content', header: 'Content', width: 60 },
];

/** Flatten sections into rows, keeping the section name on each row. */
export function toRows(data) {
  return data.sections.flatMap((s) => s.items.map((it) => ({ section: s.name, ...it, content: it.content || '' })));
}
