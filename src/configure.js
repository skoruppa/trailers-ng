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
header{display:flex;align-items:center;justify-content:space-between;margin:0 0 16px}
h1{margin:0;font-size:24px}
.repo{display:flex;color:var(--muted)}
.repo:hover{color:var(--text)}
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
<header><h1>Trailers NG</h1><a class="repo" href="https://github.com/skoruppa/trailers-ng" target="_blank" rel="noopener" aria-label="Source code on GitHub" title="Source code on GitHub"><svg viewBox="0 0 16 16" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg></a></header>
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
