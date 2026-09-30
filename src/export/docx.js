import { Document, ExternalHyperlink, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';

const safe = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

const link = (url, text = url) =>
  new ExternalHyperlink({ link: url, children: [new TextRun({ text: safe(text), style: 'Hyperlink' })] });

function label(name, value) {
  return new Paragraph({
    spacing: { after: 40 },
    children: [new TextRun({ text: `${name}: `, bold: true, color: '555555', size: 18 }), new TextRun({ text: safe(value), color: '555555', size: 18 })],
  });
}

function itemParagraphs(item) {
  const out = [];
  const isUrl = /^https?:\/\//i.test(item.url || '');
  out.push(new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 80 },
    children: isUrl ? [link(item.url, item.title || item.url)] : [new TextRun(safe(item.title || '(untitled)'))],
  }));
  if (item.date) out.push(label('Date', item.date));
  if (item.author) out.push(label('Author', item.author));
  for (const para of safe(item.description).split('\n').filter(Boolean)) {
    out.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun(para)] }));
  }
  if (item.content) {
    for (const para of safe(item.content).split(/\n{2,}/).filter(Boolean)) {
      out.push(para.startsWith('## ')
        ? new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(para.slice(3))] })
        : new Paragraph({ spacing: { after: 100 }, children: [new TextRun(para)] }));
    }
  }
  if (isUrl) {
    out.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: 'URL: ', bold: true, color: '555555', size: 18 }), link(item.url)] }));
  }
  if (item.image) {
    out.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: 'Image: ', bold: true, color: '555555', size: 18 }), link(item.image)] }));
  }
  return out;
}

export async function toDocx(data) {
  const total = data.sections.reduce((n, s) => n + s.items.length, 0);
  const siteUrl = data.site.finalUrl || data.site.url;
  const children = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(safe(data.site.title || 'Scraped website'))] }),
    new Paragraph({ children: [new TextRun({ text: 'Source: ', bold: true }), link(siteUrl)] }),
    new Paragraph({ children: [new TextRun({ text: 'Scraped: ', bold: true }), new TextRun(new Date(data.scrapedAt).toUTCString())] }),
    new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: `${data.sections.length} sections · ${total} items`, italics: true })] }),
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Contents')] }),
    ...data.sections.map((s) => new Paragraph({ bullet: { level: 0 }, children: [new TextRun(`${safe(s.name)} (${s.items.length})`)] })),
  ];
  for (const s of data.sections) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun(safe(s.name))] }));
    for (const item of s.items) children.push(...itemParagraphs(item));
  }
  const doc = new Document({
    creator: 'Site Scraper',
    title: safe(data.site.title || 'Scraped website'),
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{ children }],
  });
  return Packer.toBuffer(doc);
}
