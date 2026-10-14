from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
p=Path(__file__).resolve().parent
f=TTFont(p/'fonts/ChakraPetch-SemiBold.ttf');g=f.getGlyphSet();cmap=f.getBestCmap();x=0;parts=[];pos={}
for c in 'PULBASE':
 n=cmap[ord(c)];pen=SVGPathPen(g);g[n].draw(pen);pos[c]=x
 parts.append(f'<path transform="translate({x:.2f} 82) scale(.1 -.1)" d="{pen.getCommands()}"/>')
 x+=f['hmtx'][n][0]*.1+3
paths=''.join(parts);width=x+5
bolt='M37 12H44L35 29H43L29 56.5H22L31 39H24Z'
b=pos['B'];cuts=f'M20 12H28L24 21Z M{b+40} 12H{b+48}L{b+44} 21Z'
for variant in ['base','bolt','cuts']:
 mask=''
 if variant=='bolt':mask=f'<path d="{bolt}" fill="black" stroke="black" stroke-width="2.4" stroke-linejoin="miter"/>'
 if variant=='cuts':mask=f'<path d="{cuts}" fill="black"/>'
 svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.2f} 94" role="img" aria-label="PULBASE"><defs><mask id="cut" maskUnits="userSpaceOnUse" x="0" y="0" width="{width:.2f}" height="94"><rect width="{width:.2f}" height="94" fill="white"/>{mask}</mask></defs><g fill="white" mask="url(#cut)">{paths}</g>'+(f'<path d="{bolt}" fill="#69f7ff"/>' if variant=='bolt' else '')+'</svg>'
 (p/f'wordmark-chakra-{variant}.svg').write_text(svg)
cards=[]
for variant,title,note in [('base','基準 / Chakra Petch','加工前の文字組み'),('bolt','③ / Pに稲妻を組み込む','文字のPに、シアンの稲妻を統合'),('cuts','④ / 共通の切り欠き','P・Bの上辺に同じ角度の切り欠き')]:
 cards.append(f'<section><h2>{title}</h2><p>{note}</p><img class="large" src="wordmark-chakra-{variant}.svg"><div class="small"><img src="wordmark-chakra-{variant}.svg"></div><div class="header"><div class="category">GAME CENTER ONLINE</div><div class="lock"><img class="symbol" src="pulbase-b-slim-cyan-bolt.svg"><img class="word" src="wordmark-chakra-{variant}.svg"></div><div class="tagline">本気のプレイが、人を呼ぶ。</div></div><div class="mobile"><img src="wordmark-chakra-{variant}.svg"></div></section>')
(p/'preview-wordmarks.html').write_text('''<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PULBASE — 文字ロゴ比較</title><style>*{box-sizing:border-box}body{margin:0;background:#eaeae6;font-family:system-ui,sans-serif;color:#222}main{max-width:1100px;margin:auto;padding:28px}h1{font-size:25px;margin:0 0 10px}p{font-size:13px;line-height:1.7;color:#707580;margin:0 0 20px}section{padding:26px;background:#090b18;border-radius:12px;color:white;margin-bottom:20px}h2{font-size:17px;margin:0 0 7px}.large{width:600px;max-width:100%;display:block;margin:20px auto}.small{padding-top:18px;border-top:1px solid #303342;text-align:center}.small img{width:260px;max-width:100%}.header{margin-top:22px;padding:20px;background:#14182c;border-radius:8px}.category{font-size:12px;letter-spacing:.2em;margin-bottom:10px}.lock{display:flex;align-items:center;gap:14px}.symbol{width:64px;height:64px;flex:none}.word{width:380px;max-width:calc(100% - 78px)}.tagline{font-size:17px;font-weight:650;margin-top:10px}.mobile{margin-top:16px;width:360px;max-width:100%;border:1px solid #303342;border-radius:6px;padding:14px}.mobile img{width:100%;display:block}footer{font-size:12px;color:#666;line-height:1.7}@media(max-width:600px){main{padding:16px}section{padding:18px}.header{padding:14px}.symbol{width:40px;height:40px}.word{max-width:calc(100% - 54px)}}</style><main><h1>PULBASE — 文字ロゴの加工を比較</h1><p>基準・③・④の3案。大きな文字ロゴ、小サイズ、シンボル併用のヘッダー、幅360pxの文字ロゴ単体を並べています。</p>'''+''.join(cards)+'''<footer>Chakra Petch SemiBoldの実際の輪郭をSVG化。字間は全案共通。③は文字ロゴ単体で使うと稲妻の重複を避けられます。④はシンボル併用を想定。サイトへの適用は未実施。</footer></main></html>''')
