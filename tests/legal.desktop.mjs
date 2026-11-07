import assert from 'node:assert/strict';
import {LEGAL_VERSION, LEGAL_LINKS, LEGAL_SECTIONS} from '../dist/shared/legal.js';

export async function verifyLegalNotice(app, win) {
  const fileCount = await win.locator('.file-row').count();
  await win.locator('#nav-legal').click();
  const notice = win.locator('article.legal-notice');
  assert.equal(await notice.getAttribute('data-legal-version'), LEGAL_VERSION);
  const content = await notice.innerText();
  for (const section of LEGAL_SECTIONS) {
    assert.ok(content.includes(section.heading));
    for (const paragraph of section.paragraphs) assert.ok(content.includes(paragraph));
  }
  assert.match(content, /Uninstalling the app does not remove its local settings and history/);
  assert.match(content, /contact@forwarding\.kuykendall\.industries/);
  assert.equal(await win.locator('.file-row').count(), fileCount);
  // Verify the OS-browser handoff without sending a message or making a live request.
  await app.evaluate(({shell}) => {
    globalThis.__legalOpenExternal = shell.openExternal;
    globalThis.__legalLinks = [];
    shell.openExternal = async url => {globalThis.__legalLinks.push(url);};
  });
  try {
    await win.getByRole('button', {name:'Open KI contact form', exact:true}).click();
    await win.getByRole('button', {name:'Open KI Privacy Policy', exact:true}).click();
    await win.evaluate(async () => {
      await window.ki.openLegalLink('privacy');
      try {await window.ki.openLegalLink('https://example.invalid/private-file');}
      catch (error) {return;}
      throw Error('An arbitrary external destination was accepted.');
    });
    const opened = await app.evaluate(() => globalThis.__legalLinks);
    assert.deepEqual(opened, [LEGAL_LINKS.contact, LEGAL_LINKS.privacy, LEGAL_LINKS.privacy]);
  } finally {
    await app.evaluate(({shell}) => {shell.openExternal = globalThis.__legalOpenExternal;});
  }
  await win.locator('#nav-workspace').click();
  await app.evaluate(({Menu}) => {
    const help = Menu.getApplicationMenu().items.find(item => item.label === 'Help');
    help.submenu.items.find(item => item.label === 'Legal & privacy').click();
  });
  await notice.waitFor({state:'visible'});
  assert.equal(await win.locator('.file-row').count(), fileCount);
  await win.locator('#nav-workspace').click();
}
