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