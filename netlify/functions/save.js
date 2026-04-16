const https = require('https');
const crypto = require('crypto');

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { password, html } = body;
  if (!password || !html) {
    return { statusCode: 400, body: 'Missing password or html' };
  }

  // Verify password
  const hash = crypto.createHash('sha256').update(password).digest('hex');
  if (hash !== process.env.SAVE_PASSWORD_HASH) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  // Get current file SHA from GitHub (required for update)
  const owner = process.env.GITHUB_OWNER;
  const repo  = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;
  const path  = 'index.html';

  let sha;
  try {
    sha = await getFileSha(owner, repo, path, token);
  } catch (e) {
    return { statusCode: 500, body: 'Failed to get file SHA: ' + e.message };
  }

  // Push updated HTML to GitHub
  try {
    await updateFile(owner, repo, path, token, html, sha);
  } catch (e) {
    return { statusCode: 500, body: 'Failed to update file: ' + e.message };
  }

  return {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ ok: true })
  };
};

function getFileSha(owner, repo, path, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${owner}/${repo}/contents/${path}`,
      headers: {
        'Authorization': `token ${token}`,
        'User-Agent': 'netlify-function'
      }
    };
    https.get(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data).sha);
        } catch (e) {
          reject(new Error('Cannot parse SHA'));
        }
      });
    }).on('error', reject);
  });
}

function updateFile(owner, repo, path, token, content, sha) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      message: 'Newsletter updated via editor',
      content: Buffer.from(content).toString('base64'),
      sha: sha
    });
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${owner}/${repo}/contents/${path}`,
      method: 'PUT',
      headers: {
        'Authorization': `token ${token}`,
        'User-Agent': 'netlify-function',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve();
        else reject(new Error(`GitHub API ${res.statusCode}: ${data}`));
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}
