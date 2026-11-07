import fs from 'node:fs';
import {LEGAL_VERSION, LEGAL_DATE, LEGAL_LINKS, LEGAL_SECTIONS} from '../dist/shared/legal.js';
const body = `# METADATA — Software and Privacy Notice\n\nVersion: ${LEGAL_VERSION}\n\nEffective: ${LEGAL_DATE}\n\n` + LEGAL_SECTIONS.map(section => `## ${section.heading}\n\n${section.paragraphs.join('\n\n')}\n`).join('\n') + `\n[KI contact form](${LEGAL_LINKS.contact}) · [KI Privacy Policy](${LEGAL_LINKS.privacy})\n`;
const archive = `legal/notices/${LEGAL_VERSION}.md`;
fs.mkdirSync('legal/notices', {recursive: true});
if (fs.existsSync(archive) && fs.readFileSync(archive, 'utf8') !== body) throw Error('Published notice text changed. Assign a new legal version and preserve the earlier notice.');
fs.writeFileSync(archive, body);
fs.writeFileSync('LEGAL.md', body);
