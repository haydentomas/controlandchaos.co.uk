const fs = require('fs-extra');
const path = require('path');
const { minify: minifyHtml } = require('html-minifier-terser');
const CleanCSS = require('clean-css');
const { minify: minifyJs } = require('terser');
const { parseHTML } = require('linkedom');

const SRC_DIR = __dirname;
const DIST_DIR = path.join(__dirname, 'dist');

const cleanCss = new CleanCSS({
  level: {
    1: { all: true },
    2: { restructureRules: true }
  }
});

const htmlOptions = {
  collapseWhitespace: true,
  removeComments: true,
  removeAttributeQuotes: false,
  keepClosingSlash: true,
  removeRedundantAttributes: false,
  removeScriptTypeAttributes: true,
  removeStyleLinkTypeAttributes: true,
  useShortDoctype: true,
  minifyCSS: true,
  minifyJS: true
};

const IGNORED_PATHS = [
  'node_modules',
  '.git',
  '.gemini',
  'dist',
  'package.json',
  'package-lock.json',
  'build.js',
  '.gitignore'
];

function addPageReveal(content) {
  const { document } = parseHTML(content);
  const portalScripts = Array.from(document.querySelectorAll('script[src]')).filter(script => {
    const scriptPath = script.getAttribute('src').split('?')[0];
    return /^(?:\/|(?:\.\.?\/)*)app\.js$/.test(scriptPath);
  });
  if (!portalScripts.length) return content;
  for (const script of portalScripts) script.setAttribute('src', '/app.js?v=20261003-vip-gallery');
  for (const stylesheet of document.querySelectorAll('link[rel="stylesheet"][href]')) {
    const stylesheetPath = stylesheet.getAttribute('href').split('?')[0];
    if (/^(?:\/|(?:\.\.?\/)*)styles\.css$/.test(stylesheetPath)) {
      stylesheet.setAttribute('href', '/styles.css?v=20261003-vip-gallery');
    }
  }
  const bootstrap = `
    <style id="site-loading-critical">
      html.site-loading::before { content:''; position:fixed; inset:0; background:#12100e; z-index:2147483646; }
      html.site-loading::after { content:''; position:fixed; left:50%; top:45%; width:180px; height:100px; transform:translate(-50%,-50%); background:url('/images/logo.png') center 20px / 160px auto no-repeat; border-bottom:1px solid #d8c290; z-index:2147483647; }
      html.site-loading body { opacity:0; pointer-events:none; }
    </style>
    <script>
      window.ccPageLoadStartedAt = performance.now();
      document.documentElement.classList.add('site-loading');
      setTimeout(function() { document.documentElement.classList.remove('site-loading'); document.documentElement.removeAttribute('aria-busy'); }, 8500);
    </script>
  `;
  const charset = document.head.querySelector('meta[charset]');
  if (charset) charset.insertAdjacentHTML('afterend', bootstrap);
  else document.head.insertAdjacentHTML('afterbegin', bootstrap);
  return document.toString();
}

async function processDirectory(src, dest) {
  await fs.ensureDir(dest);
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (IGNORED_PATHS.includes(entry.name)) {
      continue;
    }

    if (entry.isDirectory()) {
      await processDirectory(srcPath, destPath);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();

      if (ext === '.html') {
        const content = addPageReveal(await fs.readFile(srcPath, 'utf8'));
        try {
          const minified = await minifyHtml(content, htmlOptions);
          await fs.writeFile(destPath, minified, 'utf8');
        } catch (err) {
          console.warn(`[WARN] Failed to minify HTML: ${srcPath}`, err.message);
          await fs.copyFile(srcPath, destPath);
        }
      } else if (ext === '.css') {
        const content = await fs.readFile(srcPath, 'utf8');
        const minified = cleanCss.minify(content);
        if (minified.styles) {
          await fs.writeFile(destPath, minified.styles, 'utf8');
        } else {
          await fs.copyFile(srcPath, destPath);
        }
      } else if (ext === '.js' && !srcPath.includes('admin')) {
        // Minify JS files (exclude third party bundles if any)
        const content = await fs.readFile(srcPath, 'utf8');
        try {
          const minified = await minifyJs(content, {
            compress: true,
            mangle: true
          });
          await fs.writeFile(destPath, minified.code || content, 'utf8');
        } catch (err) {
          console.warn(`[WARN] Failed to minify JS: ${srcPath}`, err.message);
          await fs.copyFile(srcPath, destPath);
        }
      } else {
        // Copy static assets directly (_redirects, images, json, svg, yml, etc.)
        await fs.copyFile(srcPath, destPath);
      }
    }
  }
}

async function run() {
  console.log('🚀 Running static generators (blog posts & escort profiles)...');
  try {
    const { buildProfiles } = require('./scripts/build-profiles.js');
    buildProfiles();
  } catch (err) {
    console.warn('[WARN] Profile builder warning:', err.message);
  }

  try {
    if (await fs.pathExists(path.join(__dirname, 'scripts/build-posts.js'))) {
      const { execSync } = require('child_process');
      execSync('node scripts/build-posts.js', { stdio: 'inherit' });
    }
  } catch (err) {
    console.warn('[WARN] Posts builder warning:', err.message);
  }

  console.log('🚀 Building and minifying Control & Chaos web ecosystem...');
  await fs.remove(DIST_DIR);
  await processDirectory(SRC_DIR, DIST_DIR);

  // Ensure _redirects is copied if exists
  const redirectsSrc = path.join(SRC_DIR, '_redirects');
  const redirectsDest = path.join(DIST_DIR, '_redirects');
  if (await fs.pathExists(redirectsSrc)) {
    await fs.copyFile(redirectsSrc, redirectsDest);
  }

  console.log('✨ Build complete! All HTML, CSS, and JS fully minified into dist/');
}

if (require.main === module) {
  run().catch((err) => {
    console.error('❌ Build failed:', err);
    process.exit(1);
  });
}

module.exports = { addPageReveal };
