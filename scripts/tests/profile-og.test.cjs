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