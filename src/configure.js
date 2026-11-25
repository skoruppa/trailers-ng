import { LANGUAGES } from './config.js';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

export function configurePage(config, origin, version) {
  const options = Object.entries(LANGUAGES)
    .map(
      ([code, { name }]) =>
        `<option value="${code}"${code === config.lang ? ' selected' : ''}>${escapeHtml(name)} (${code.toUpperCase()})</option>`
    )
    .join('');
  const checked = value => (value ? ' checked' : '');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Trailers NG</title>
<style>
:root{color-scheme:dark;--bg:#0f1115;--card:#181b22;--text:#e8eaf0;--muted:#9aa3b2;--accent:#5b8cff;--border:#2a2f3a}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,sans-serif;padding:16px}
main{width:100%;max-width:520px;background:var(--card);border:1px solid var(--border);border-radius:16px;padding:24px}
h1{margin:0 0 16px;font-size:24px}
[hidden]{display:none!important}
p{margin:0 0 20px;color:var(--muted)}
label{display:block;margin:0 0 14px}
select,input[type=text]{width:100%;margin-top:6px;padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:var(--bg);color:var(--text);font:inherit}
.check{display:flex;gap:10px;align-items:flex-start}
.check input{margin-top:4px}
.check span small{display:block;color:var(--muted)}
.row{display:flex;gap:10px;margin-top:8px}
button{flex:1;text-align:center;padding:11px 14px;border-radius:10px;border:0;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}
.hint{margin:14px 0 0;font-size:14px}
footer{margin-top:16px;color:var(--muted);font-size:13px}
footer a{color:var(--muted)}
</style>
</head>
<body>
<main>
<h1>Trailers NG</h1>
<form id="form">
<label>Preferred language<select id="lang">${options}</select></label>
<label class="check" id="english-row"${config.lang === 'en' ? ' hidden' : ''}><input type="checkbox" id="english"${checked(config.english)}><span>Fall back to English<small>Show English trailers when there is none in the preferred language.</small></span></label>
<label class="check"><input type="checkbox" id="youtube"${checked(config.youtube)}><span>YouTube trailers<small>Add YouTube trailers after the direct files.</small></span></label>
<label>Manifest URL<input type="text" id="manifest" readonly></label>
<div class="row"><button type="button" id="copy">Copy</button></div>
<p class="hint">This is a trailer provider, not a regular addon. Paste the URL into AIOMetadata as the trailer addon (Meta Providers, Trailers), or add it in Fusion.</p>
</form>
<footer>Trailers NG ${escapeHtml(version)}<br>YouTube fallback trailers use data from <a href="https://www.themoviedb.org/" rel="noopener">TMDB</a> when the instance has a TMDB API key. This product uses the TMDB API but is not endorsed or certified by TMDB.</footer>
</main>
<script>
const origin = ${JSON.stringify(origin)};
const el = id => document.getElementById(id);
function encode() {
  const lang = el('lang').value;
  const parts = [lang];
  if (lang !== 'en' && el('english').checked) parts.push('en');
  if (!el('youtube').checked) parts.push('noyt');
  return parts.join('+');
}
function update() {
  el('english-row').hidden = el('lang').value === 'en';
  const url = origin + '/' + encode() + '/manifest.json';
  el('manifest').value = url;
}
el('form').addEventListener('change', update);
el('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(el('manifest').value); el('copy').textContent = 'Copied'; }
  catch { el('manifest').select(); }
  setTimeout(() => { el('copy').textContent = 'Copy'; }, 1500);
});
update();
</script>
</body>
</html>`;
}
