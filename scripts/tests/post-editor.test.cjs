const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { parseHTML } = require('linkedom');

const html = fs.readFileSync(path.join(__dirname, '../../directory/edit/index.html'), 'utf8');

function setup(stored = new Map(), owner = 'jane') {
  const { document, window } = parseHTML(html);
  window.HTMLElement.prototype.scrollIntoView = function() {};
  window.HTMLElement.prototype.focus = function() {};
  for (const select of document.querySelectorAll('select')) {
    let value = select.querySelector('option')?.getAttribute('value') || '';
    Object.defineProperty(select, 'value', { get: () => value, set: next => { value = next; } });
  }
  const beforeUnloadHandlers = [];
  const context = vm.createContext({
    document, console, URLSearchParams,
    window: { addEventListener: (event, handler) => { if (event === 'beforeunload') beforeUnloadHandlers.push(handler); } },
    setTimeout() {}, confirm: () => false, alert() {},
    localStorage: {
      getItem: key => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, value),
      removeItem: key => stored.delete(key)
    }
  });
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/src=/.test(match[1])) vm.runInContext(match[2], context);
  }
  vm.runInContext(`currentProfile = {id: ${JSON.stringify(owner)}};
    blogPostsList = [{id:'first',title:'First',content:'Original'},{id:'second',title:'Second',content:'Second body'}];
    postsList = [{id:'feed-first',title:'Feed',content:'Original feed',type:'text',is_locked:true}];`, context);
  context.initializePostEditors();
  context.renderBlogPosts();
  context.renderFeedPosts();
  return { context, document, stored, beforeUnloadHandlers };
}

test('post editors are inline, identified by headings, and placed beneath the selected post', () => {
  const { context, document } = setup();
  context.openEditBlogPostModal(0);
  const editor = document.getElementById('blog-post-modal');
  assert.equal(editor.tagName, 'SECTION');
  assert.equal(editor.previousElementSibling.id, 'blog-post-row-0');
  assert.equal(editor.getAttribute('onclick'), null);
  assert.ok(editor.previousElementSibling.classList.contains('post-row-editing'));
  assert.equal(document.querySelectorAll('.editor-modal-backdrop').length, 0);
  context.openEditPostModal(0);
  assert.equal(document.getElementById('feed-post-modal').previousElementSibling.id, 'feed-post-row-0');
});

test('Escape and outside clicks do not close the editor; input saves the draft', () => {
  const { context, document, stored } = setup();
  context.openEditBlogPostModal(0);
  const input = document.getElementById('modal-blog-content');
  input.value = 'Typed draft';
  const { Event } = document.defaultView;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  document.body.dispatchEvent(new Event('click', { bubbles: true }));
  const keydown = new Event('keydown', { bubbles: true });
  keydown.key = 'Escape';
  document.dispatchEvent(keydown);
  assert.ok(document.getElementById('blog-post-modal').classList.contains('open'));
  assert.equal(JSON.parse(stored.get('cc_post_draft_jane_blog')).fields['modal-blog-content'], 'Typed draft');
});

test('switching posts or discarding requires confirmation; closing and reopening retains the draft', () => {
  const { context, document } = setup();
  context.openEditBlogPostModal(0);
  document.getElementById('modal-blog-content').value = 'Keep this draft';
  context.persistPostDraft('blog');
  context.openEditBlogPostModal(1);
  assert.equal(document.getElementById('modal-blog-content').value, 'Keep this draft');
  context.discardPostDraft('blog');
  assert.ok(document.getElementById('blog-post-modal').classList.contains('open'));
  context.closeBlogPostModal();
  context.openEditBlogPostModal(0);
  assert.equal(document.getElementById('modal-blog-content').value, 'Keep this draft');
});

test('draft recovery follows post identity after a list reorder and is scoped to the creator', () => {
  const original = setup();
  original.context.openEditBlogPostModal(0);
  original.document.getElementById('modal-blog-content').value = 'Recovered text';
  original.context.persistPostDraft('blog');
  const reloaded = setup(original.stored);
  vm.runInContext('blogPostsList.reverse();', reloaded.context);
  reloaded.context.renderBlogPosts();
  reloaded.context.restorePostDraft('blog');
  assert.equal(reloaded.document.getElementById('modal-blog-index').value, '1');
  assert.equal(reloaded.document.getElementById('modal-blog-content').value, 'Recovered text');
  assert.equal(setup(original.stored, 'another-owner').context.readPostDraft('blog'), null);
});

test('saving a blog or feed post clears its active draft but persists unpublished changes', () => {
  const { context, document, stored } = setup();
  context.openEditBlogPostModal(0);
  document.getElementById('modal-blog-content').value = 'Saved blog';
  context.persistPostDraft('blog');
  assert.equal(context.saveBlogPostModal(), true);
  assert.ok(!stored.has('cc_post_draft_jane_blog'));
  assert.equal(context.readPostChanges().blog_posts[0].content, 'Saved blog');
  context.openEditPostModal(0);
  document.getElementById('modal-post-content').value = 'Saved feed';
  context.persistPostDraft('feed');
  assert.equal(context.savePostModal(), true);
  assert.equal(context.readPostChanges().posts[0].content, 'Saved feed');
  assert.ok(document.getElementById('blog-post-modal'));
  assert.ok(document.getElementById('feed-post-modal'));
});

test('formatting toolbar changes are persisted and invalid posts remain open', () => {
  const { context, document, stored } = setup();
  context.openCreateBlogPostModal();
  context.insertBlogMarkdown('bold');
  assert.match(JSON.parse(stored.get('cc_post_draft_jane_blog')).fields['modal-blog-content'], /\*\*/);
  assert.equal(context.saveBlogPostModal(), false);
  assert.ok(document.getElementById('blog-post-modal').classList.contains('open'));
});

test('rerendering the post list preserves the active editor and its values', () => {
  const { context, document } = setup();
  context.openEditPostModal(0);
  document.getElementById('modal-post-content').value = 'Still here';
  context.renderFeedPosts();
  assert.equal(document.getElementById('modal-post-content').value, 'Still here');
  assert.ok(document.getElementById('feed-post-modal').classList.contains('open'));
});

test('leaving the page warns for unsaved drafts', () => {
  const { context, document, beforeUnloadHandlers } = setup();
  context.openEditBlogPostModal(0);
  document.getElementById('modal-blog-content').value = 'Unsaved draft';
  let prevented = false;
  const event = { preventDefault: () => { prevented = true; } };
  beforeUnloadHandlers[0](event);
  assert.ok(prevented);
  assert.equal(event.returnValue, '');
});

test('Save Profile includes active draft edits and clears pending changes only after publication', async () => {
  const { context, document, stored } = setup();
  let payload;
  context.fetch = async (url, options) => {
    payload = JSON.parse(options.body);
    return { ok: true, json: async () => ({ success: true }) };
  };
  context.openEditBlogPostModal(0);
  document.getElementById('modal-blog-content').value = 'Publish this draft';
  await context.saveProfile();
  assert.equal(payload.profileData.blog_posts[0].content, 'Publish this draft');
  assert.ok(!stored.has('cc_post_draft_jane_blog'));
  assert.ok(!stored.has('cc_post_draft_jane_collections'));
});

test('failed publication preserves unpublished post changes for recovery', async () => {
  const { context, document, stored } = setup();
  context.fetch = async () => ({ ok: false, json: async () => ({ error: 'Offline' }) });
  context.openEditPostModal(0);
  document.getElementById('modal-post-content').value = 'Keep after failed publish';
  await context.saveProfile();
  assert.equal(JSON.parse(stored.get('cc_post_draft_jane_collections')).posts[0].content, 'Keep after failed publish');
});

test('editing and saving still work when local storage is unavailable', () => {
  const { context, document } = setup();
  context.localStorage.setItem = () => { throw new Error('Storage unavailable'); };
  context.localStorage.removeItem = () => { throw new Error('Storage unavailable'); };
  context.openEditBlogPostModal(0);
  document.getElementById('modal-blog-content').value = 'Unsaved locally';
  context.persistPostDraft('blog');
  assert.match(document.getElementById('blog-post-draft-status').textContent, /unavailable/);
  assert.equal(context.saveBlogPostModal(), true);
});

test('Markdown source is preserved when previewing, returning to editing, and saving', () => {
  const { context, document } = setup();
  const source = '## A heading\n\n**Bold text** and [a link](https://example.com)\n\n- First item\n- Second item';
  context.openEditBlogPostModal(0);
  const input = document.getElementById('modal-blog-content');
  input.value = source;
  context.persistPostDraft('blog');
  assert.match(document.getElementById('blog-tab-write').textContent, /Markdown/);
  context.switchBlogContentMode('preview');
  assert.equal(input.value, source);
  assert.equal(input.style.display, 'none');
  assert.ok(document.querySelector('#modal-blog-preview-rendered h2'));
  assert.ok(document.querySelector('#modal-blog-preview-rendered strong'));
  assert.ok(document.querySelector('#modal-blog-preview-rendered a[href="https://example.com"]'));
  assert.equal(document.getElementById('blog-tab-preview').getAttribute('aria-pressed'), 'true');
  context.switchBlogContentMode('write');
  assert.equal(input.value, source);
  assert.equal(input.style.display, 'block');
  assert.equal(document.getElementById('blog-tab-write').getAttribute('aria-pressed'), 'true');
  assert.equal(context.saveBlogPostModal(), true);
  assert.equal(context.readPostChanges().blog_posts[0].content, source);
});

test('custom feed excerpts are draft-protected, saved, and removable', () => {
  const { context, document, stored } = setup();
  context.openEditBlogPostModal(0);
  document.getElementById('modal-blog-excerpt').value = 'A short custom introduction.';
  context.persistPostDraft('blog');
  assert.equal(JSON.parse(stored.get('cc_post_draft_jane_blog')).fields['modal-blog-excerpt'], 'A short custom introduction.');
  context.saveBlogPostModal();
  assert.equal(context.readPostChanges().blog_posts[0].excerpt, 'A short custom introduction.');
  context.openEditBlogPostModal(0);
  document.getElementById('modal-blog-excerpt').value = '';
  context.saveBlogPostModal();
  assert.equal(context.readPostChanges().blog_posts[0].excerpt, undefined);
});

test('formatting buttons preserve source and page scroll while retaining selection', () => {
  for (const type of ['bold', 'italic', 'h2', 'list', 'link', 'quote', 'divider']) {
    const { context, document } = setup();
    context.openEditBlogPostModal(0);
    const textarea = document.getElementById('modal-blog-content');
    textarea.value = 'Before selected text after\n' + 'A long paragraph.\n'.repeat(100);
    textarea.selectionStart = 7;
    textarea.selectionEnd = 15;
    textarea.scrollTop = 430;
    textarea.scrollLeft = 12;
    context.window.scrollY = 800;
    context.window.scrollX = 4;
    let focusedWithoutScrolling = false;
    textarea.focus = options => {
      focusedWithoutScrolling = options?.preventScroll === true;
      textarea.scrollTop = 1900;
    };
    context.window.scrollTo = options => {
      context.window.scrollY = options.top;
      context.window.scrollX = options.left;
    };
    let nextFrame;
    context.window.requestAnimationFrame = callback => { nextFrame = callback; };
    context.insertBlogMarkdown(type);
    assert.ok(focusedWithoutScrolling);
    assert.equal(textarea.scrollTop, 430);
    assert.equal(textarea.scrollLeft, 12);
    assert.equal(context.window.scrollY, 800);
    assert.equal(context.window.scrollX, 4);
    textarea.scrollTop = 1900;
    nextFrame();
    assert.equal(textarea.scrollTop, 430);
  }
});

test('formatting in preview does not focus hidden source and refreshes the preview in place', () => {
  const { context, document } = setup();
  context.openEditBlogPostModal(0);
  const textarea = document.getElementById('modal-blog-content');
  textarea.value = 'Selected words';
  textarea.selectionStart = 0;
  textarea.selectionEnd = 8;
  context.switchBlogContentMode('preview');
  textarea.focus = () => { throw new Error('Hidden source should not be focused'); };
  const preview = document.getElementById('modal-blog-preview-rendered');
  preview.scrollTop = 120;
  context.insertBlogMarkdown('bold');
  assert.equal(preview.querySelector('strong').textContent, 'Selected');
  assert.equal(preview.scrollTop, 120);
  assert.equal(textarea.style.display, 'none');
});

test('returning from preview preserves the Markdown scroll position without scrolling focus', () => {
  const { context, document } = setup();
  context.openEditBlogPostModal(0);
  const textarea = document.getElementById('modal-blog-content');
  textarea.scrollTop = 350;
  context.switchBlogContentMode('preview');
  textarea.scrollTop = 0;
  textarea.focus = options => {
    assert.equal(options.preventScroll, true);
    textarea.scrollTop = 999;
  };
  context.switchBlogContentMode('write');
  assert.equal(textarea.scrollTop, 350);
});

test('gallery management is a dedicated backend section and new VIP images do not automatically enter the rate card', () => {
  const { context, document } = setup();
  assert.equal(document.getElementById('gallery-manager-card').parentElement.id, 'gallery-manager-slot');
  vm.runInContext('currentProfile.is_vip = true;', context);
  context.addGalleryItem();
  assert.equal(vm.runInContext('galleryItems[0].show_on_ratecard', context), false);
  assert.ok(document.getElementById('gallery-description-0'));
  assert.ok(document.querySelector('.gallery-manager-preview'));
});

test('VIP feature controls retain disabled selections and are locked for basic profiles', () => {
  const { context, document } = setup();
  vm.runInContext('currentProfile.is_vip = true;', context);
  context.renderProfileFeatureSwitches({ is_vip: true, feature_visibility: { public_blog: false } });
  assert.ok(!document.querySelector('[data-profile-feature="public_blog"]').hasAttribute('checked'));
  for (const input of document.querySelectorAll('[data-profile-feature]')) input.checked = input.hasAttribute('checked');
  assert.equal(context.collectProfileFeatureVisibility().public_blog, false);
  assert.equal(context.collectProfileFeatureVisibility().full_gallery, true);
  vm.runInContext('currentProfile.is_vip = false;', context);
  context.renderProfileFeatureSwitches({ plan: 'basic' });
  assert.ok(document.querySelector('[data-profile-feature="full_gallery"]').hasAttribute('disabled'));
  assert.deepEqual(Object.keys(context.collectProfileFeatureVisibility()), []);
});

test('saving a VIP profile includes gallery descriptions, rate-card choices, and feature switches without deleting content', async () => {
  const { context, document } = setup();
  vm.runInContext('currentProfile.is_vip = true; currentProfile.plan = "vip"; galleryItems = [{image:"/photo.jpg", description:"A photo description", show_on_ratecard:false}];', context);
  context.renderProfileFeatureSwitches({ is_vip: true });
  for (const input of document.querySelectorAll('[data-profile-feature]')) input.checked = true;
  document.querySelector('[data-profile-feature="public_blog"]').checked = false;
  let payload;
  context.fetch = async (url, options) => { payload = JSON.parse(options.body); return { ok: true, json: async () => ({ success: true }) }; };
  await context.saveProfile();
  assert.equal(payload.profileData.feature_visibility.public_blog, false);
  assert.equal(payload.profileData.gallery[0].description, 'A photo description');
  assert.equal(payload.profileData.gallery[0].show_on_ratecard, false);
  assert.equal(payload.profileData.blog_posts.length, 2);
  assert.equal(vm.runInContext('currentProfile.is_vip', context), true);
  assert.equal(context.collectProfileFeatureVisibility().public_blog, false);
});

test('custom-domain instructions require administrator registration and show correct root and www DNS records', () => {
  const { document } = setup();
  const guide = document.getElementById('custom-domain-setup-guide');
  const text = guide.textContent.replace(/\s+/g, ' ');
  assert.match(text, /does not automatically register the domain with Netlify/);
  assert.match(text, /add your domain as an alias/);
  assert.ok(guide.querySelector('a[href="/contact/"]'));
  const rows = [...guide.querySelectorAll('tbody tr')].map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent.trim()));
  assert.equal(rows[0][0], 'A');
  assert.equal(rows[0][1], '@');
  assert.match(rows[0][2], /75\.2\.60\.5/);
  assert.equal(rows[1][0], 'CNAME');
  assert.equal(rows[1][1], 'www');
  assert.match(rows[1][2], /heartfelt-centaur-ab06af\.netlify\.app/);
  assert.match(text, /Subdomain only/);
  assert.match(text, /HTTPS certificate activation/);
  assert.ok(!text.includes('5 to 30 minutes'));
  for (const detail of guide.querySelectorAll('details')) {
    assert.match(detail.textContent, /75\.2\.60\.5/);
    assert.match(detail.textContent, /heartfelt-centaur-ab06af\.netlify\.app/);
  }
});