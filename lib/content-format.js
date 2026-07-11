export function sectionsToEditorText(sections) {
  return sections.map((section) => {
    const paragraphs = section.paragraphs.join("\n\n");
    const points = section.points?.map((point) => `- ${point}`).join("\n") ?? "";
    return [`## ${section.title}`, paragraphs, points].filter(Boolean).join("\n\n");
  }).join("\n\n");
}

export function editorTextToSections(source) {
  const lines = source.replace(/\r/g, "").split("\n");
  const sections = [];
  let current = null;
  let paragraph = [];

  const ensureSection = () => {
    if (!current) current = { title: "본문", paragraphs: [], points: [] };
    return current;
  };

  const flushParagraph = () => {
    if (!paragraph.length) return;
    ensureSection().paragraphs.push(paragraph.join(" ").trim());
    paragraph = [];
  };

  const flushSection = () => {
    flushParagraph();
    if (!current) return;
    if (!current.points.length) delete current.points;
    if (current.paragraphs.length || current.points?.length) sections.push(current);
    current = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("## ")) {
      flushSection();
      current = { title: trimmed.slice(3).trim() || "본문", paragraphs: [], points: [] };
    } else if (trimmed.startsWith("- ")) {
      flushParagraph();
      ensureSection().points.push(trimmed.slice(2).trim());
    } else if (!trimmed) {
      flushParagraph();
    } else {
      paragraph.push(trimmed);
    }
  }

  flushSection();
  return sections;
}
