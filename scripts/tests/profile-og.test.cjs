const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { minify } = require('html-minifier-terser');
const { parseHTML } = require('linkedom');

const root = path.resolve(__dirname, '../..');
const template = fs.readFileSync(path.join(root, 'directory/profile.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'netlify/edge-functions/profile-og.js'), 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace('export default async function handler', 'async function handler');
const profile = {
  id: 'alek-zane',
  name: 'Alek Zane',
  seo_title: 'Profile title',
  seo_description: 'Profile description',
  avatar_image: '/images/avatar.jpg',
  blog_posts: [{
    title: 'I just wanna se if batman exists',
    content: '**Full article** body.',
    seo_title: 'Yeah ok rude boy & "friends"',
    seo_description: 'Custom description <not markup> & more',
    media_url: '/assets/uploads/article.jpg'
  }]
};
const articleUrl = 'https://controlandchaos.co.uk/profile/alek-zane/blog/i-just-wanna-se-if-batman-exists/';

function handlerFor(data, parser = parseHTML) {
  return vm.runInNewContext(`${source}\nhandler;`, {
    getStore: () => ({ get: async key => key === 'alek-zane' ? data : null }),
    parseHTML: parser,
    URL,
    Request,
    Response,
    Headers
  });
}

async function rewrite(html, data = profile, url = articleUrl) {
  const origin = new Response(html, {
    headers: { 'Content-Type': 'text/html', 'ETag': 'old-page', 'Content-Length': '1' }
  });
  const response = await handlerFor(data)(new Request(url), { next: async () => origin });
  const { document } = parseHTML(await response.text());
  return { document, response };
}

for (const minified of [false, true]) {
  test(`article metadata overrides work with ${minified ? 'production-minified' : 'quoted'} HTML`, async () => {
    const html = minified ? await minify(template, {
      collapseWhitespace: true,
      removeAttributeQuotes: true,
      removeScriptTypeAttributes: true,
      minifyCSS: true,
      minifyJS: true
    }) : template;
    if (minified) assert.match(html, /name=description/);
    const { document, response } = await rewrite(html);
    const post = profile.blog_posts[0];
    assert.equal(document.title, post.seo_title);
    for (const selector of ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']) {
      assert.equal(document.querySelector(selector).getAttribute('content'), post.seo_description);
    }
    for (const selector of ['meta[property="og:title"]', 'meta[name="twitter:title"]']) {
      assert.equal(document.querySelector(selector).getAttribute('content'), post.seo_title);
    }
    for (const selector of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
      assert.equal(document.querySelector(selector).getAttribute('content'), 'https://controlandchaos.co.uk/assets/uploads/article.jpg');
    }
    assert.equal(document.querySelector('meta[property="og:type"]').getAttribute('content'), 'article');
    assert.equal(document.querySelector('meta[property="og:url"]').getAttribute('content'), articleUrl);
    assert.equal(document.querySelector('link[rel="canonical"]').getAttribute('href'), articleUrl);
    const schema = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent);
    assert.equal(schema['@type'], 'BlogPosting');
    assert.equal(schema.description, post.seo_description);
    assert.equal(schema.headline, post.title);
    assert.equal(schema.url, articleUrl);
    assert.ok(document.querySelector('script[src="/app.js"]'));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('etag'), null);
    assert.equal(response.headers.get('content-length'), null);
  });
}

test('automatic post metadata uses post text and attached image, not profile overrides', async () => {
  const data = structuredClone(profile);
  delete data.blog_posts[0].seo_title;
  delete data.blog_posts[0].seo_description;
  const { document } = await rewrite(template, data);
  assert.match(document.title, /^I just wanna se if batman exists/);
  assert.equal(document.querySelector('meta[name="description"]').getAttribute('content'), 'Full article body.');
  assert.equal(document.querySelector('meta[property="og:image"]').getAttribute('content'), 'https://controlandchaos.co.uk/assets/uploads/article.jpg');
});

test('profile routes keep profile metadata', async () => {
  const { document } = await rewrite(template, profile, 'https://controlandchaos.co.uk/profile/alek-zane/');
  assert.equal(document.title, profile.seo_title);
  assert.equal(document.querySelector('meta[name="description"]').getAttribute('content'), profile.seo_description);
  assert.equal(document.querySelector('meta[property="og:type"]').getAttribute('content'), 'profile');
});

test('missing metadata tags are created', async () => {
  const { document } = await rewrite('<!doctype html><html><head></head><body>Article</body></html>');
  assert.equal(document.title, profile.blog_posts[0].seo_title);
  assert.equal(document.querySelector('meta[name="twitter:card"]').getAttribute('content'), 'summary_large_image');
  assert.equal(document.querySelector('link[rel="canonical"]').getAttribute('href'), articleUrl);
});

test('parser failure returns the original readable response', async () => {
  const origin = new Response(template, { headers: { 'Content-Type': 'text/html' } });
  const handler = handlerFor(profile, () => { throw new Error('Parser failure'); });
  const response = await handler(new Request(articleUrl), { next: async () => origin });
  assert.equal(await response.text(), template);
});

const routerSource = fs.readFileSync(path.join(root, 'netlify/edge-functions/custom-domain-router.js'), 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace('export default async function handler', 'async function handler');

async function mirrorResponse(pathname, data = { ...profile, is_vip: true, custom_domain: 'alek.example' }) {
  const upstreamRequests = [];
  const router = vm.runInNewContext(`${routerSource}\nhandler;`, {
    URL, Request, Response, parseHTML, console,
    getStore: () => ({ get: async key => key === 'domain_alek.example' ? data : null }),
    fetch: async url => {
      upstreamRequests.push(new URL(url));
      return handlerFor(data)(new Request(url), { next: async () => new Response(template, { headers: { 'Content-Type': 'text/html' } }) });
    }
  });
  const response = await router(new Request('https://alek.example' + pathname), {
    next: async () => new Response('passthrough')
  });
  const { document } = parseHTML(await response.text());
  return { response, document, upstreamRequests };
}

test('custom-domain profile keeps C&C canonical and identifies its owner', async () => {
  const { document, upstreamRequests } = await mirrorResponse('/');
  assert.equal(upstreamRequests[0].pathname, '/profile/alek-zane/');
  assert.equal(document.querySelector('meta[name="cc-profile-id"]').getAttribute('content'), 'alek-zane');
  assert.equal(document.querySelector('link[rel="canonical"]').getAttribute('href'), 'https://controlandchaos.co.uk/profile/alek-zane/');
  assert.ok(document.body.classList.contains('is-whitelabel-custom-domain'));
});

test('custom-domain article fetches the article and preserves its C&C metadata', async () => {
  const { document, upstreamRequests } = await mirrorResponse('/blog/i-just-wanna-se-if-batman-exists/');
  assert.equal(upstreamRequests[0].pathname, new URL(articleUrl).pathname);
  assert.equal(document.querySelector('link[rel="canonical"]').getAttribute('href'), articleUrl);
  assert.equal(document.querySelector('meta[property="og:type"]').getAttribute('content'), 'article');
  assert.equal(document.title, profile.blog_posts[0].seo_title);
});

test('custom-domain blog index selects the blog tab; non-VIP domains are blocked', async () => {
  const index = await mirrorResponse('/blog/');
  assert.equal(index.upstreamRequests[0].searchParams.get('tab'), 'blog');
  const blocked = await mirrorResponse('/', { ...profile, is_vip: false });
  assert.equal(blocked.response.status, 403);
  assert.equal(blocked.upstreamRequests.length, 0);
});

test('custom-domain assets pass through and unrelated profile paths do not impersonate the owner', async () => {
  const asset = await mirrorResponse('/directory/profiles/alek-zane.json');
  assert.equal(asset.upstreamRequests.length, 0);
  const unrelated = await mirrorResponse('/profile/someone-else/blog/post/');
  assert.equal(unrelated.response.status, 404);
  assert.equal(unrelated.upstreamRequests.length, 0);
});

function browserContext(url, ownerId = '', runtime = {}) {
  const { document } = parseHTML(template);
  const loadCallbacks = [];
  document.addEventListener = (event, callback) => {
    if (event === 'DOMContentLoaded') loadCallbacks.push(callback);
  };
  if (ownerId) {
    const marker = document.createElement('meta');
    marker.setAttribute('name', 'cc-profile-id');
    marker.setAttribute('content', ownerId);
    document.head.appendChild(marker);
  }
  const context = vm.createContext({
    window: { location: new URL(url) }, document, URL, URLSearchParams,
    localStorage: { getItem: () => null }, console, ...runtime
  });
  for (const match of template.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/src=|application\/ld\+json/.test(match[1])) vm.runInContext(match[2], context);
  }
  context.loadCallbacks = loadCallbacks;
  return context;
}

test('browser identifies custom-domain owners and clean blog routes without changing the host', () => {
  for (const pathname of ['/', '/blog/my-update/', '/profile/jane-doe/blog/my-update/']) {
    const context = browserContext('https://jane.example' + pathname, 'jane-doe');
    const route = context.profileRouteForLocation();
    assert.equal(route.profileId, 'jane-doe');
    assert.equal(route.isBlogPostRoute, pathname !== '/');
    assert.equal(route.postSlug, pathname === '/' ? '' : 'my-update');
    assert.equal(context.profileBasePath({ name: 'Jane Doe' }), '/');
    assert.equal(context.profileArticlePath({ name: 'Jane Doe' }, 'my-update'), '/blog/my-update/');
    assert.equal(context.window.location.hostname, 'jane.example');
  }
});

test('live custom-domain articles retain C&C canonicals and mirror navigation', () => {
  const context = browserContext('https://alek.example/blog/i-just-wanna-se-if-batman-exists/', 'alek-zane');
  context.renderDynamicArticleView(profile, profile.blog_posts[0], [{ title: 'Another post', slug: 'another-post' }]);
  const document = context.document;
  assert.equal(document.querySelector('link[rel="canonical"]').getAttribute('href'), articleUrl);
  assert.ok(document.querySelector('main a[href="/?tab=blog"]'));
  assert.ok(document.querySelector('main a[href="/blog/another-post/"]'));
  assert.ok(document.querySelector('main a[href="/?tab=ratecard#booking-enquiry-section"]'));
});

test('directory profile and article routes keep C&C navigation', () => {
  const context = browserContext(articleUrl);
  assert.equal(context.profileRouteForLocation().profileId, 'alek-zane');
  assert.equal(context.profileRouteForLocation().isBlogPostRoute, true);
  assert.equal(context.profileArticlePath(profile, 'another-post'), '/profile/alek-zane/blog/another-post/');
  context.renderDynamicArticleView(profile, profile.blog_posts[0], []);
  assert.ok(context.document.querySelector('main a[href="/profile/alek-zane/?tab=blog"]'));
});

test('public blog cards lead with lazy images and show excerpts instead of full bodies', () => {
  const context = browserContext('https://controlandchaos.co.uk/profile/alek-zane/');
  const content = 'Opening paragraph with **bold words**. '.repeat(30) + 'FULL ARTICLE END';
  const card = context.renderPublicBlogCard(profile, { title: 'Long post', content, media_url: '/assets/photo.jpg' }, 0);
  const { document } = parseHTML(`<html><body>${card}</body></html>`);
  const article = document.querySelector('article');
  assert.ok(article.firstElementChild.classList.contains('blog-feed-image-link'));
  assert.equal(article.querySelector('img').getAttribute('loading'), 'lazy');
  assert.equal(article.querySelector('img').getAttribute('decoding'), 'async');
  const excerpt = article.querySelector('.blog-feed-excerpt').textContent;
  assert.ok(excerpt.length <= 263);
  assert.ok(excerpt.endsWith('...'));
  assert.ok(!card.includes('FULL ARTICLE END'));
  assert.ok(!excerpt.includes('**'));
  assert.ok(article.querySelector('a.blog-feed-read[href="/profile/alek-zane/blog/long-post/"]'));
});

test('custom excerpts are plain text, with correct mirror article links and no image placeholder', () => {
  const context = browserContext('https://alek.example/', 'alek-zane');
  const card = context.renderPublicBlogCard(profile, { title: 'Post', excerpt: '**A short teaser** <script>bad()</script>', content: 'Full body is not a teaser.' }, 0);
  const { document } = parseHTML(`<html><body>${card}</body></html>`);
  assert.equal(document.querySelector('.blog-feed-excerpt').textContent, 'A short teaser <script>bad()</script>');
  assert.equal(document.querySelectorAll('script').length, 0);
  assert.equal(document.querySelectorAll('.blog-feed-image-link').length, 0);
  assert.ok(document.querySelector('a.blog-feed-read[href="/blog/post/"]'));
  assert.ok(!card.includes('Full body is not a teaser.'));
});

async function loadedFeed(hash = '', withObserver = false) {
  const stored = new Map();
  const fixture = JSON.parse(fs.readFileSync(path.join(root, 'directory/profiles/alek-zane.json'), 'utf8'));
  fixture.blog_posts = Array.from({ length: 12 }, (_, index) => ({
    id: `post-${index}`, slug: `entry-${index}`, title: `Entry ${index}`, content: 'Short excerpt.', likes: 0
  }));
  const observers = [];
  const context = browserContext('https://controlandchaos.co.uk/profile/alek-zane/' + hash, '', {
    setTimeout() {},
    fetch: async url => ({ ok: true, json: async () => url.includes('/.netlify/') ? { profile: fixture, subscriptions: {} } : fixture }),
    localStorage: { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value) }
  });
  if (withObserver) {
    const Observer = class {
      constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
      observe(element) { this.element = element; }
      disconnect() { this.disconnected = true; }
    };
    context.window.IntersectionObserver = Observer;
    context.IntersectionObserver = Observer;
  }
  await context.loadCallbacks[0]();
  context.window.switchProfileTab('blog');
  return { context, document: context.document, observers };
}

test('public blog renders five cards at a time and Load More appends without resetting likes', async () => {
  const { context, document } = await loadedFeed();
  assert.equal(document.querySelectorAll('.blog-feed-card').length, 5);
  const first = document.querySelector('.blog-feed-card');
  document.getElementById('blog-load-more').click();
  assert.equal(document.querySelectorAll('.blog-feed-card').length, 10);
  context.window.toggleBlogLike(document.getElementById('blog-like-btn-0').getAttribute('data-key'), 0);
  assert.equal(document.getElementById('blog-like-count-0').textContent, '1 Likes');
  assert.equal(document.querySelector('.blog-feed-card'), first);
  assert.equal(document.querySelectorAll('.blog-feed-card').length, 10);
  context.window.switchProfileTab('ratecard');
  context.window.switchProfileTab('blog');
  assert.equal(document.querySelectorAll('.blog-feed-card').length, 10);
  document.getElementById('blog-load-more').click();
  assert.equal(document.querySelectorAll('.blog-feed-card').length, 12);
  assert.ok(document.getElementById('blog-load-more').hidden);
});

test('scroll loading appends batches only while the blog tab is visible', async () => {
  const { context, document, observers } = await loadedFeed('', true);
  const observer = observers[0];
  context.window.switchProfileTab('ratecard');
  observer.callback([{ isIntersecting: true }]);
  assert.equal(document.querySelectorAll('.blog-feed-card').length, 5);
  context.window.switchProfileTab('blog');
  observer.callback([{ isIntersecting: true }]);
  assert.equal(document.querySelectorAll('.blog-feed-card').length, 10);
  observer.callback([{ isIntersecting: true }]);
  assert.equal(document.querySelectorAll('.blog-feed-card').length, 12);
  assert.ok(observer.disconnected);
});

test('deep links render the batch containing the requested post', async () => {
  const { document } = await loadedFeed('#post-entry-10');
  assert.ok(document.getElementById('post-entry-10'));
});