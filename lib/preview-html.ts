/** Shared HTML wrappers for in-WebView previews (no file:// access required). */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function wrapPdfPreviewHtml(base64: string): string {
  const safe = base64.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=4.0"/>
<style>
html,body{margin:0;height:100%;background:#525659;}
#viewer{width:100%;height:100%;overflow:auto;-webkit-overflow-scrolling:touch;}
canvas{display:block;margin:8px auto;box-shadow:0 2px 8px rgba(0,0,0,.35);}
</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"><\/script>
</head><body><div id="viewer"></div>
<script>
pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
(async function(){
  try {
    var raw=atob('${safe}');
    var bytes=new Uint8Array(raw.length);
    for(var i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i);
    var pdf=await pdfjsLib.getDocument({data:bytes}).promise;
    var viewer=document.getElementById('viewer');
    for(var p=1;p<=pdf.numPages;p++){
      var page=await pdf.getPage(p);
      var vp=page.getViewport({scale:1.4});
      var c=document.createElement('canvas');
      c.width=vp.width; c.height=vp.height;
      viewer.appendChild(c);
      await page.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;
    }
  } catch(e) {
    document.body.innerHTML='<p style="color:#fff;padding:16px;font-family:sans-serif">Could not render PDF</p>';
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
