import { normalizeExerciseImageUrl } from './exercise-images.js';

const clean = (value) => typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : '';

export function exerciseDisplayImageUrl(apiImageUrl) {
  return normalizeExerciseImageUrl(apiImageUrl);
}

export function formatExerciseDetails(exercise) {
  if (!exercise) return null;
  const exerciseNotes = clean(exercise.exerciseNotes);
  const sources = [
    ['Description', exerciseNotes],
    ['This session', clean(exercise.notes) === exerciseNotes ? '' : clean(exercise.notes)],
    ['Recent sessions', clean(exercise.historyNotes).replace(/^Past sessions(?:\n|$)/, '').trim()],
    ['Program', clean(exercise.description)],
  ];
  const seen = new Set();
  return sources.filter(([, body]) => {
    if (!body || seen.has(body)) return false;
    seen.add(body);
    return true;
  }).map(([title, body]) => `## ${title}\n${body}`).join('\n\n') || null;
}

function plain(text) {
  return text.replace(/^```[^\n]*\n?/gm, '')
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/\*\*|__|~~|`/g, '')
    .replace(/(^|[^\w])_([^_\n]+)_(?=[^\w]|$)/g, '$1$2')
    .replace(/\*([^*]+)\*/g, '$1');
}

function wrap(text, width) {
  return text.split('\n').flatMap((line) => {
    const lines = [];
    let rest = line.trim();
    while (rest.length > width) {
      const space = rest.lastIndexOf(' ', width);
      const end = space > 0 ? space : width;
      lines.push(rest.slice(0, end));
      rest = rest.slice(end).trimStart();
    }
    return [...lines, rest];
  });
}

export function paginateNotes(text, maxCharsPerPage = 90, maxLinesPerPage = 6, maxCharsPerLine = 23, firstPage = null) {
  const content = clean(text);
  if (!content) return ['No notes for this exercise.'];
  const sections = [];
  for (const line of content.split('\n')) {
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) sections.push({ title: plain(heading[1]), lines: [] });
    else {
      if (!sections.length) sections.push({ title: '', lines: [] });
      sections[sections.length - 1].lines.push(line);
    }
  }
  const pages = [];
  const limits = () => pages.length === 0 && firstPage
    ? { chars: firstPage.chars, lines: firstPage.lines }
    : { chars: maxCharsPerPage, lines: maxLinesPerPage };
  for (const section of sections) {
    let body = plain(section.lines.join('\n')).trim();
    let title = section.title ? wrap(section.title, maxCharsPerLine) : [];
    let prefixLength = title.length ? title.join('\n').length + 1 : 0;
    if (title.length >= limits().lines || prefixLength >= limits().chars) {
      // Authored headings may exceed a page; flow them once as ordinary content.
      body = `${section.title}\n${body}`;
      title = [];
      prefixLength = 0;
    }
    if (!body) continue;
    const lines = wrap(body, Math.min(maxCharsPerLine, limits().chars - prefixLength));
    let page = [...title];
    for (const line of lines) {
      if (page.length > title.length && (page.length >= limits().lines || [...page, line].join('\n').length > limits().chars)) {
        pages.push(page.join('\n'));
        page = [...title];
      }
      page.push(line);
    }
    if (page.length > title.length) pages.push(page.join('\n'));
  }
  return pages.length ? pages : ['No notes for this exercise.'];
}
