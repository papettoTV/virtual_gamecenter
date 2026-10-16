from pathlib import Path
import xml.etree.ElementTree as E
p=Path('deliverables/pulbase-logo-b')
base=(p/'pulbase-b-slim-cyan-bolt.svg').read_text()
old='M28 20H176Q228 20 228 72V120Q228 172 176 172H72V228Q72 236 64 236H28Q20 236 20 228V28Q20 20 28 20Z'
new='M20 20H196L228 52V140L196 172H72V236H20Z'
assert old in base
angular=base.replace(old,new).replace('cyan bolt','angular comparison')
(p/'pulbase-b-angular-cyan.svg').write_text(angular)
E.register_namespace('', 'http://www.w3.org/2000/svg');ns={'s':'http://www.w3.org/2000/svg'}
root=E.fromstring((p/'wordmark-chakra-base.svg').read_text());paths=list(root.find('s:g',ns))[1:]
letters=''.join(E.tostring(el,encoding='unicode') for el in paths)
for variant,symbol in [('round',base),('angular',angular)]:
 symbol=symbol.replace('viewBox="0 0 256 256"', 'x="0.519" y="5.519" width="82.963" height="82.963" viewBox="0 0 256 256"')
 svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 478.9 94" role="img" aria-label="PULBASE">{symbol}<g transform="translate(12 0)" fill="white">{letters}</g></svg>'
 (p/f'wordmark-symbol-{variant}.svg').write_text(svg)
sections=[]
for variant,label,src in [('round','現行 / 丸いP','pulbase-b-slim-cyan-bolt.svg'),('angular','比較案 / 面取りしたP','pulbase-b-angular-cyan.svg')]:
 sections.append(f'<section><h2>{label}</h2><div class="profile"><img src="{src}"></div><div class="favicons"><img width="16" height="16" src="favicon-compare-{variant}-16.png"><span>16px</span><img width="32" height="32" src="favicon-compare-{variant}-32.png"><span>32px</span></div><div class="line"><img src="wordmark-symbol-{variant}.svg"></div><div class="small"><img src="wordmark-symbol-{variant}.svg"></div></section>')
(p/'preview-angular.html').write_text('''<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PULBASE — 丸いPと面取りP</title><style>*{box-sizing:border-box}body{margin:0;background:#eaeae6;font-family:system-ui,sans-serif;color:#222}main{max-width:1240px;margin:auto;padding:28px}h1{font-size:25px;margin:0 0 10px}p{font-size:14px;color:#555;line-height:1.7;margin:0 0 22px}.grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px}section{background:#090b18;color:white;padding:24px;border-radius:12px;min-width:0}h2{font-size:17px;margin:0 0 22px}.profile{width:224px;height:224px;border-radius:50%;background:#090b18;border:1px solid #35394a;margin:auto;display:grid;place-items:center}.profile img{width:176px;height:176px}.favicons{display:flex;gap:12px;align-items:center;justify-content:center;margin:28px 0}.favicons span{font-size:12px;color:#aab4d6;margin-right:12px}.line{border-top:1px solid #303342;padding-top:26px}.line img{width:100%;display:block}.small{margin-top:24px}.small img{width:280px;max-width:100%;display:block}footer{font-size:13px;color:#555;line-height:1.8;margin-top:20px}@media(max-width:700px){.grid{grid-template-columns:minmax(0,1fr)}main{padding:16px}}</style><main><h1>PULBASE — 丸いP ／ 面取りしたP</h1><p>外側の輪郭だけを変更。内側の丸い抜き・稲妻・配色は同じ。各列に丸いプロフィール表示、実寸favicon、文字ロゴの大・小を並べました。</p><div class="grid">'''+''.join(sections)+'''</div><footer>文字ロゴは両案とも「同じシンボルを頭文字として使う」構成に統一し、外形の違いを比較。ULBASEの形・字間・位置は共通です。<br>サイトで現在使っている「Chakra PetchのP＋稲妻」とは異なる比較用文字ロゴ。採用データとサイトは変更していません。</footer></main></html>''')
