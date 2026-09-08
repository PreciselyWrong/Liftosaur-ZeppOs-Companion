const clean = (value) => typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : '';

export function formatExerciseDetails(exercise) {
  if (!exercise) return null;
  const exerciseNotes = clean(exercise.exerciseNotes);
  const sources = [
    ['Recent sessions', clean(exercise.historyNotes).replace(/^Past sessions(?:\n|$)/, '').trim()],
    ['This session', clean(exercise.notes) === exerciseNotes ? '' : clean(exercise.notes)],
    ['Exercise', exerciseNotes],
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
  return text.replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*|__|`/g, '')
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

export function paginateNotes(text, maxCharsPerPage = 90, maxLinesPerPage = 6, maxCharsPerLine = 23) {
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
  for (const section of sections) {
    const body = plain(section.lines.join('\n')).trim();
    if (!body) continue;
    const title = section.title ? wrap(section.title, maxCharsPerLine) : [];
    const prefixLength = title.length ? title.join('\n').length + 1 : 0;
    if (title.length >= maxLinesPerPage || prefixLength >= maxCharsPerPage) {
      throw new RangeError('Notes page budget must leave room below the section title');
    }
    const lines = wrap(body, Math.min(maxCharsPerLine, maxCharsPerPage - prefixLength));
    let page = [...title];
    for (const line of lines) {
      if (page.length > title.length && (page.length >= maxLinesPerPage || [...page, line].join('\n').length > maxCharsPerPage)) {
        pages.push(page.join('\n'));
        page = [...title];
      }
      page.push(line);
    }
    if (page.length > title.length) pages.push(page.join('\n'));
  }
  return pages.length ? pages : ['No notes for this exercise.'];
}
