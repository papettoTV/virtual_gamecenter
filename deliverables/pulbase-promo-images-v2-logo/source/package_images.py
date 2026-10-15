#!/usr/bin/env python3
"""Create a contact sheet, local gallery, dimension/hash manifest, and delivery ZIP."""
import hashlib, html, json, zipfile
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

PACK=Path(__file__).resolve().parents[1]
specs=json.loads((PACK/'source/sizes.json').read_text())
checks=[]
for s in specs:
    layout=PACK/'source/layouts'/s['id']
    cache=list((layout/'.hyperframes/artifacts/checks').glob('*.json'))
    report=json.loads(max(cache,key=lambda p:p.stat().st_mtime).read_text())
    assert report['ok'] and report['strict'] and not report['browserSkipped'],s['id']
    audits={}
    for key in ['lint','runtime','layout','motion','contrast']:
        section=report[key]
        assert section['errorCount']==0 and section['warningCount']==0,(s['id'],key)
        audits[key]=dict(errors=section['errorCount'],warnings=section['warningCount'])
    checks.append(dict(id=s['id'],passed=True,htmlSha256=hashlib.sha256((layout/'index.html').read_bytes()).hexdigest(),audits=audits,contrastChecks=report['contrast']['checked']))
(PACK/'verification.json').write_text(json.dumps(dict(tool='HyperFrames 0.8.162',strict=True,layouts=checks,visualReview='All layouts in contact sheet; three small ads also inspected at native size',exportChecks='Pillow verify, exact pixel dimensions, ad PNG/JPEG <= 150000 bytes'),ensure_ascii=False,indent=2)+'\n')
font_path=PACK.parent/'pulbase-C-hyperframes/cut/assets/Japanese.ttc'
font=ImageFont.truetype(str(font_path),21)
small=ImageFont.truetype(str(font_path),17)
heading=ImageFont.truetype(str(font_path),34)
sheet=Image.new('RGB',(1920,2040),'#eae7e1')
draw=ImageDraw.Draw(sheet)
draw.text((32,22),'PULBASE / PROMOTIONAL IMAGES / LOGO v2',font=heading,fill='#171322')
draw.text((32,70),'11 sizes · approved wordmark / individually adapted layouts',font=small,fill='#4c4754')
items=[];cards=[]
for i,s in enumerate(specs):
    stem=f"pulbase-logo-{s['id']}-{s['w']}x{s['h']}"
    files=[]
    for fmt in ['png','jpg','webp']:
        file=PACK/fmt/f'{stem}.{fmt}'
        if not file.exists():continue
        with Image.open(file) as image:
            image.verify()
        with Image.open(file) as image:
            assert image.size==(s['w'],s['h']),str(file)
        n=file.stat().st_size
        if s['id'].startswith('ad-') and fmt in ['jpg','png']:assert n<=150000,(file,n)
        files.append(dict(path=file.relative_to(PACK).as_posix(),format=fmt,width=s['w'],height=s['h'],bytes=n,sha256=hashlib.sha256(file.read_bytes()).hexdigest()))
    items.append(dict(id=s['id'],use=s['use'],width=s['w'],height=s['h'],files=files))
    cx=(i%3)*640+16;cy=(i//3)*480+120
    draw.rounded_rectangle((cx,cy,cx+608,cy+456),radius=12,fill='#fffdfa')
    draw.text((cx+16,cy+12),s['use'],font=font,fill='#171322')
    draw.text((cx+16,cy+43),f"{s['id']}  /  {s['w']} × {s['h']}",font=small,fill='#686071')
    with Image.open(PACK/'png'/f'{stem}.png') as image:
        preview=ImageOps.contain(image,(576,352),Image.Resampling.LANCZOS)
        if image.width<=576 and image.height<=352: preview=image.copy() # never enlarge the small ads
        px=cx+304-preview.width//2;py=cy+90+(352-preview.height)//2
        sheet.paste(preview,(px,py))
    links=' '.join(f'<a href="{f["path"]}" download>{f["format"].upper()} · {f["bytes"]/1024:.0f}KB</a>' for f in files)
    cards.append(f'<figure><figcaption><strong>{html.escape(s["use"])}</strong><span>{s["w"]} × {s["h"]} / {s["id"]}</span></figcaption><div class="image"><a href="png/{stem}.png"><img src="jpg/{stem}.jpg" width="{s["w"]}" height="{s["h"]}" alt="{html.escape(s["use"])}のPULBASE宣伝画像"></a></div><nav>{links}</nav></figure>')
sheet.save(PACK/'contact-sheet.jpg',quality=92,subsampling=0,optimize=True)
# Two matched layouts show the effect of the approved wordmark at large and small sizes.
comparison=Image.new('RGB',(1920,850),'#eae7e1')
cdraw=ImageDraw.Draw(comparison)
for x,label,folder,prefix in [(36,'v1 / 通常の文字タイトル','pulbase-promo-images-v1','pulbase'),(984,'v2 / 採用した文字ロゴ','pulbase-promo-images-v2-logo','pulbase-logo')]:
    cdraw.text((x,24),label,font=heading,fill='#171322')
    with Image.open(PACK.parent/folder/'png'/f'{prefix}-ogp-1200x630.png') as image:
        comparison.paste(image.resize((900,473),Image.Resampling.LANCZOS),(x,92))
    cdraw.text((x,610),'モバイル広告 / 320 × 100（原寸）',font=font,fill='#171322')
    with Image.open(PACK.parent/folder/'png'/f'{prefix}-ad-mobile-320x100.png') as image:
        comparison.paste(image,(x,660))
cdraw.text((36,804),'背景・コピー・URLを揃えて比較。ロゴは採用済みSVGを縦横比と配色を保って使用。',font=small,fill='#4c4754')
comparison.save(PACK/'comparison-before-after.jpg',quality=92,subsampling=0,optimize=True)

logo=PACK/'brand/pulbase-wordmark.svg'
assert hashlib.sha256(logo.read_bytes()).hexdigest()=='c98a5f7a139d83e70afe285a80cc21503dd3cd3b46a752288feb39ae8d6b5c82'
manifest=dict(logo=dict(path='brand/pulbase-wordmark.svg',sha256=hashlib.sha256(logo.read_bytes()).hexdigest(),source='../pulbase-logo-b/wordmark-chakra-bolt.svg'),title='PULBASE promotional images v2 logo',created='2026-10-16',sourcePhoto='../pulbase-C-hyperframes/cut/assets/arcade-opening-crowded-v1.png',sourcePhotoSha256='030c49ad0a6615da99e5187e1fba03fb4ebf89d94edebe5e1bb6cfcf26f83feb',layouts=items)
(PACK/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
(PACK/'index.html').write_text('''<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PULBASE 宣伝画像 v2 ロゴ版</title><style>
*{box-sizing:border-box}body{margin:0;background:#eeeae5;color:#171322;font-family:system-ui,sans-serif}header{padding:32px 24px;max-width:1600px;margin:auto}h1{margin:0 0 12px}header p{line-height:1.8}a{color:#125f76}main{max-width:1600px;padding:0 24px 40px;margin:auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:24px}figure{margin:0;padding:20px;background:#fffdfa;border-radius:12px;display:flex;flex-direction:column;gap:16px}figcaption strong,figcaption span{display:block}figcaption span{color:#61596b;font-size:14px;margin-top:6px}.image{background:#eae7e1;display:flex;align-items:center;justify-content:center;min-height:200px;flex:1;padding:12px}.image img{display:block;width:auto;height:auto;max-width:100%;max-height:480px}nav{display:flex;gap:16px;flex-wrap:wrap;font-size:14px}footer{padding:24px;max-width:1600px;margin:auto;color:#61596b;font-size:14px}
</style></head><body><header><h1>PULBASE 宣伝画像 v2 ロゴ版</h1><p>採用済み文字ロゴを使った11サイズ。用途に合わせて文字・写真・余白を個別に調整しています。<br>各画像をクリックするとPNGの原寸を開きます。投稿にはJPEG、サイトにはWebPも選べます。</p><a href="PULBASE-promo-images-v2-logo.zip" download>一括ダウンロード ZIP</a> · <a href="README.md">使い方・サイズ選定</a> · <a href="contact-sheet.jpg">一覧画像</a> · <a href="comparison-before-after.jpg">v1との比較</a></header><main>'''+''.join(cards)+'''</main><footer>小型広告は原寸を超えて拡大していません。表示領域より大きい画像は縮小表示しています。元動画は変更していません。</footer></body></html>''')
zip_path=PACK/'PULBASE-promo-images-v2-logo.zip'
with zipfile.ZipFile(zip_path,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for directory in ['png','jpg','webp','brand']:
        for f in sorted((PACK/directory).iterdir()):z.write(f,'PULBASE-promo-images-v2-logo/'+f.relative_to(PACK).as_posix())
    for name in ['README.md','manifest.json','verification.json','index.html','contact-sheet.jpg','comparison-before-after.jpg']:
        if name=='index.html':
            z.writestr('PULBASE-promo-images-v2-logo/index.html',(PACK/name).read_text().replace('<a href="PULBASE-promo-images-v2-logo.zip" download>一括ダウンロード ZIP</a> · ',''))
        else:z.write(PACK/name,'PULBASE-promo-images-v2-logo/'+name)
print(json.dumps(dict(layouts=len(items),images=sum(len(i['files']) for i in items),zipBytes=zip_path.stat().st_size,adBytes={i['id']:{f['format']:f['bytes'] for f in i['files']} for i in items if i['id'].startswith('ad-')}),indent=2))
