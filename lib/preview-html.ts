/** Shared HTML wrappers for in-WebView previews (no file:// access required). */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeJsString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

const PDF_JS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';

const PDF_PREVIEW_STYLES = `
html,body{margin:0;min-height:100%;background:#525659;}
#viewer{width:100%;min-height:100vh;overflow:auto;-webkit-overflow-scrolling:touch;padding-bottom:24px;}
canvas{display:block;width:100%;max-width:100%;height:auto;margin:8px auto;box-shadow:0 2px 8px rgba(0,0,0,.35);}
#status{position:fixed;top:0;left:0;right:0;padding:10px 14px;background:rgba(0,0,0,.72);color:#fff;font:13px sans-serif;z-index:2;text-align:center;}
`;

function wrapPdfRenderScript(loadPdf: string): string {
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=4.0"/>
<style>${PDF_PREVIEW_STYLES}</style>
<script src="${PDF_JS_CDN}/pdf.min.js"><\/script>
</head><body><div id="status">Loading PDF…</div><div id="viewer"></div>
<script>
pdfjsLib.GlobalWorkerOptions.workerSrc='${PDF_JS_CDN}/pdf.worker.min.js';
(async function(){
  var status=document.getElementById('status');
  var viewer=document.getElementById('viewer');
  try {
    var pdf=await (${loadPdf});
    var screenW=window.innerWidth||document.documentElement.clientWidth||360;
    var pad=16;
    for(var p=1;p<=pdf.numPages;p++){
      status.textContent='Rendering page '+p+' of '+pdf.numPages;
      var page=await pdf.getPage(p);
      var baseVp=page.getViewport({scale:1});
      var fitScale=(screenW-pad)/baseVp.width;
      var scale=Math.min(Math.max(fitScale,0.5),2.5);
      var vp=page.getViewport({scale:scale});
      var c=document.createElement('canvas');
      c.width=vp.width; c.height=vp.height;
      c.style.width='100%';
      c.style.height='auto';
      c.style.maxWidth='100%';
      viewer.appendChild(c);
      await page.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;
      await new Promise(function(r){ setTimeout(r,0); });
    }
    status.style.display='none';
  } catch(e) {
    status.textContent='Could not render PDF';
    viewer.innerHTML='<p style="color:#fff;padding:16px;font-family:sans-serif">'+String(e)+'</p>';
  }
})();
<\/script>
</body></html>`;
}

/** Embed PDF bytes as base64 (small files). */
export function wrapPdfPreviewHtml(base64: string): string {
  const safe = base64.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const loadPdf = `(async function(){
    var raw=atob('${safe}');
    var bytes=new Uint8Array(raw.length);
    for(var i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i);
    return pdfjsLib.getDocument({data:bytes}).promise;
  })()`;
  return wrapPdfRenderScript(loadPdf);
}

/** Fetch PDF from HTTPS URL (avoids huge HTML strings; renders all pages). */
export function wrapPdfPreviewFetchHtml(url: string, bearerToken?: string | null): string {
  const safeUrl = escapeJsString(url);
  const headersExpr = bearerToken
    ? `{ 'Authorization': 'Bearer ${escapeJsString(bearerToken)}' }`
    : '{}';
  const loadPdf = `pdfjsLib.getDocument({ url: '${safeUrl}', httpHeaders: ${headersExpr}, withCredentials: false }).promise`;
  return wrapPdfRenderScript(loadPdf);
}

export function wrapVideoPreviewHtml(url: string, bearerToken?: string | null): string {
  const safeUrl = escapeJsString(url);
  const headersExpr = bearerToken
    ? `headers: { 'Authorization': 'Bearer ${escapeJsString(bearerToken)}' }`
    : '';
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<style>html,body{margin:0;height:100%;background:#000;display:flex;align-items:center;justify-content:center;}
video{max-width:100%;max-height:100vh;background:#000;}</style>
</head><body>
<video id="v" controls playsinline style="width:100%;max-height:100vh;"></video>
<script>
(async function(){
  try {
    var res=await fetch('${safeUrl}', { ${headersExpr} });
    if(!res.ok) throw new Error('HTTP '+res.status);
    var blob=await res.blob();
    document.getElementById('v').src=URL.createObjectURL(blob);
  } catch(e) {
    document.body.innerHTML='<p style="color:#fff;padding:16px;font-family:sans-serif">Could not play video</p>';
  }
})();
<\/script>
</body></html>`;
}

export function wrapImagePreviewHtml(base64: string, mime: string): string {
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<style>body{margin:0;background:#f6f8fc;display:flex;align-items:center;justify-content:center;min-height:100vh;}
img{max-width:100%;max-height:100vh;object-fit:contain;}</style>
</head><body>
<img src="data:${escapeHtml(mime)};base64,${base64}" alt="preview"/>
</body></html>`;
}
