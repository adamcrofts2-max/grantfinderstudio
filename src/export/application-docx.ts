/**
 * An application as a Word document.
 *
 * Rendering only: what goes in, and in what order, is decided in
 * `src/domain/export/application.ts`, where it is tested without this. Word
 * because it is what a trustee opens, what an email-application funder asks
 * for, and what a bid writer edits — and every word processor reads it.
 *
 * Plain on purpose. One typeface, the funder's questions as headings, the
 * answers as body text. A document styled like the product would look like
 * it came from software; this should look like it came from the applicant.
 */

import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';

import type { ExportDocument } from '../domain/export/application.js';

const FONT = 'Arial';

export async function renderApplicationDocx(doc: ExportDocument): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(doc.title)] }),
    ...doc.details.map(
      (line) =>
        new Paragraph({
          spacing: { after: 40 },
          children: [new TextRun({ text: line, color: '555555' })],
        }),
    ),
  ];

  for (const section of doc.sections) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 360, after: 80 },
        children: [new TextRun(section.heading)],
      }),
    );
    if (section.limit !== null) {
      children.push(
        new Paragraph({
          spacing: { after: 120 },
          children: [new TextRun({ text: section.limit, italics: true, color: '555555' })],
        }),
      );
    }
    if (section.paragraphs.length === 0) {
      children.push(
        new Paragraph({ children: [new TextRun({ text: 'Not yet answered.', italics: true })] }),
      );
    } else {
      for (const paragraph of section.paragraphs) {
        children.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun(paragraph)] }));
      }
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: section.standing,
              size: 18,
              color: section.overLimit ? '9A1F1F' : '555555',
              bold: section.overLimit,
            }),
          ],
        }),
      );
    }
  }

  children.push(
    new Paragraph({
      spacing: { before: 480 },
      children: [new TextRun({ text: doc.closing, italics: true, size: 18, color: '555555' })],
    }),
  );

  const document = new Document({
    creator: 'Grant Finder Studio',
    title: doc.title,
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: [{ children }],
  });
  return Packer.toBuffer(document);
}
